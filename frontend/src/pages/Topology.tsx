import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { timeAgo } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  displayName: string;
  avatar: string | null;
  status: string;
  kind?: string;
  currentTask?: string | null;
  codexSessionId?: string;
  activeRunIds?: string[];
  taskIds?: string[];
}

interface GraphEdge {
  source: string;
  target: string;
  kind?: 'admin_agent' | 'admin_mother' | 'agent_agent' | 'mother_observation' | 'system';
  label?: string;
  messageCount: number;
  lastMessage: string;
  threadIds?: string[];
  codexSessionIds?: string[];
  sessionIds?: string[];
  activeRunIds?: string[];
  taskIds?: string[];
  recentMessages?: Array<{
    id: string;
    role?: string;
    content: string;
    createdAt: string;
    threadId: string;
    codexSessionId?: string;
    nexusSessionId?: string;
    requestId?: string;
  }>;
  observationLinks?: Array<{
    type: 'task' | 'session' | 'context';
    id: string;
    label: string;
    status?: string;
  }>;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  activity: number; // total message count for this node
}

interface Particle {
  edgeIndex: number;
  progress: number; // 0-1
  speed: number;
  forward: boolean; // direction along edge
}

// ─── Constants ─────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  ONLINE: '#10b981',
  IDLE: '#f59e0b',
  OFFLINE: '#6b7280',
  ERROR: '#ef4444',
};
const EDGE_COLORS: Record<string, string> = {
  admin_agent: '#3b8eff',
  admin_mother: '#a78bfa',
  agent_agent: '#10b981',
  mother_observation: '#f59e0b',
  system: '#64748b',
};

const REPULSION = 8000;
const ATTRACTION = 0.005;
const CENTER_GRAVITY = 0.02;
const DAMPING = 0.92;
const MIN_NODE_RADIUS = 28;
const MAX_NODE_RADIUS = 48;
const MAX_PARTICLES = 60;

// ─── Force Simulation ──────────────────────────────────

function initializeNodes(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): SimNode[] {
  // Calculate activity per node (total messages sent + received)
  const activityMap = new Map<string, number>();
  for (const edge of edges) {
    activityMap.set(edge.source, (activityMap.get(edge.source) ?? 0) + edge.messageCount);
    activityMap.set(edge.target, (activityMap.get(edge.target) ?? 0) + edge.messageCount);
  }
  const maxActivity = Math.max(1, ...activityMap.values());

  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const spread = Math.min(width, height) * 0.25;
    const activity = activityMap.get(node.id) ?? 0;
    const normalized = activity / maxActivity;
    const radius = MIN_NODE_RADIUS + normalized * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);

    return {
      ...node,
      x: width / 2 + Math.cos(angle) * spread,
      y: height / 2 + Math.sin(angle) * spread,
      vx: 0,
      vy: 0,
      radius,
      activity,
    };
  });
}

function stepSimulation(
  nodes: SimNode[],
  edges: GraphEdge[],
  width: number,
  height: number
): void {
  const cx = width / 2;
  const cy = height / 2;

  // Reset forces
  for (const node of nodes) {
    // Center gravity
    node.vx += (cx - node.x) * CENTER_GRAVITY;
    node.vy += (cy - node.y) * CENTER_GRAVITY;
  }

  // Node-node repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) { dist = 1; dx = 1; dy = 0; }
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Edge attraction (spring)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;

    // Stronger attraction for more messages
    const strength = ATTRACTION * Math.log2(edge.messageCount + 1);
    const fx = dx * strength;
    const fy = dy * strength;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  // Apply velocities and damping
  const padding = 60;
  for (const node of nodes) {
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;

    // Keep nodes within bounds
    node.x = Math.max(padding + node.radius, Math.min(width - padding - node.radius, node.x));
    node.y = Math.max(padding + node.radius, Math.min(height - padding - node.radius, node.y));
  }
}

// ─── Detail Panel ──────────────────────────────────────

function DetailPanel({
  node,
  edges,
  allNodes,
  onClose,
}: {
  node: SimNode;
  edges: GraphEdge[];
  allNodes: SimNode[];
  onClose: () => void;
}) {
  const nodeEdges = edges.filter((e) => e.source === node.id || e.target === node.id);
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const totalMessages = nodeEdges.reduce((sum, e) => sum + e.messageCount, 0);

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-surface-900 border-l border-white/5 z-20 overflow-y-auto animate-slide-in">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors text-lg"
      >
        x
      </button>

      {/* Agent header */}
      <div className="px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
            style={{ backgroundColor: `${STATUS_COLORS[node.status]}20` }}
          >
            {node.avatar ?? '?'}
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">{node.displayName}</h3>
            <span className="text-xs text-gray-500 font-mono">{node.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[node.status] }}
          />
          <span
            className="text-sm font-medium"
            style={{ color: STATUS_COLORS[node.status] }}
          >
            {node.status}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="px-6 py-4 border-b border-white/5">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <div className="text-xs text-gray-500">Connections</div>
            <div className="text-lg font-bold text-white font-mono">{nodeEdges.length}</div>
          </div>
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <div className="text-xs text-gray-500">Messages</div>
            <div className="text-lg font-bold text-white font-mono">{totalMessages}</div>
          </div>
        </div>
      </div>

      {/* Connected agents */}
      <div className="px-6 py-4">
        <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Connections</h4>
        <div className="space-y-2">
          {nodeEdges
            .sort((a, b) => b.messageCount - a.messageCount)
            .map((edge) => {
              const otherId = edge.source === node.id ? edge.target : edge.source;
              const other = nodeMap.get(otherId);
              if (!other) return null;

              return (
                <div
                  key={`${edge.source}-${edge.target}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <span className="text-lg">{other.avatar ?? '?'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{other.displayName}</div>
                    <div className="text-xs text-gray-500 truncate">
                      Last: {timeAgo(edge.lastMessage)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 font-mono shrink-0">
                    {edge.messageCount} msg{edge.messageCount !== 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          {nodeEdges.length === 0 && (
            <div className="text-sm text-gray-500 py-2">No connections</div>
          )}
        </div>
      </div>
    </div>
  );
}

function EdgeDetailPanel({
  edge,
  nodeMap,
  onClose,
}: {
  edge: GraphEdge;
  nodeMap: Map<string, SimNode>;
  onClose: () => void;
}) {
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  const color = EDGE_COLORS[edge.kind || 'system'] ?? EDGE_COLORS.system;
  const chips = [
    { label: 'Codex', values: edge.codexSessionIds ?? [] },
    { label: 'Sessions', values: edge.sessionIds ?? [] },
    { label: 'Active runs', values: edge.activeRunIds ?? [] },
    { label: 'Tasks', values: edge.taskIds ?? [] },
    { label: 'Threads', values: edge.threadIds ?? [] },
  ].filter(item => item.values.length > 0);

  return (
    <div className="absolute right-0 top-0 h-full w-96 bg-surface-900 border-l border-white/5 z-20 overflow-y-auto animate-slide-in">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors text-lg"
      >
        x
      </button>

      <div className="px-6 pt-6 pb-4 border-b border-white/5">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Connection</div>
        <h3 className="text-lg font-bold text-white">
          {source?.displayName || edge.source} {'->'} {target?.displayName || edge.target}
        </h3>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium" style={{ color }}>{edge.label || edge.kind || 'System'}</span>
          <span className="text-xs text-gray-600">Last {timeAgo(edge.lastMessage)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-6 py-4 border-b border-white/5">
        <div className="bg-white/5 rounded-lg px-3 py-2">
          <div className="text-xs text-gray-500">Messages</div>
          <div className="text-lg font-bold text-white font-mono">{edge.messageCount}</div>
        </div>
        <div className="bg-white/5 rounded-lg px-3 py-2">
          <div className="text-xs text-gray-500">Observations</div>
          <div className="text-lg font-bold text-white font-mono">{edge.observationLinks?.length ?? 0}</div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="px-6 py-4 border-b border-white/5">
          <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Runtime Links</h4>
          <div className="space-y-3">
            {chips.map(item => (
              <div key={item.label}>
                <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {item.values.slice(0, 6).map(value => (
                    <span key={value} className="rounded bg-white/5 px-2 py-1 text-[11px] font-mono text-gray-300">
                      {value.slice(0, 8)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(edge.observationLinks?.length ?? 0) > 0 && (
        <div className="px-6 py-4 border-b border-white/5">
          <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Mother Chat Links</h4>
          <div className="space-y-2">
            {edge.observationLinks!.map(link => (
              <div key={`${link.type}-${link.id}`} className="rounded-lg bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white truncate">{link.label}</span>
                  {link.status && <span className="text-[10px] uppercase text-gray-500">{link.status}</span>}
                </div>
                <div className="text-[11px] text-gray-600 mt-1">{link.type}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-6 py-4">
        <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Recent Messages</h4>
        <div className="space-y-2">
          {(edge.recentMessages ?? []).map(message => (
            <div key={message.id} className="rounded-lg bg-white/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] uppercase text-gray-500">{message.role || 'message'}</span>
                <span className="text-[11px] text-gray-600">{timeAgo(message.createdAt)}</span>
              </div>
              <div className="text-sm text-gray-300 leading-relaxed">{message.content}</div>
            </div>
          ))}
          {(edge.recentMessages ?? []).length === 0 && (
            <div className="text-sm text-gray-500 py-2">No message samples for this connection.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────

export function Topology() {
  const [rawNodes, setRawNodes] = useState<GraphNode[]>([]);
  const [rawEdges, setRawEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeRef = useRef({ width: 900, height: 600 });
  const [, forceRender] = useState(0);

  const fetchGraph = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setRefreshing(true);
    try {
      const data = await api.threads.graph();
      setRawNodes(data.nodes);
      setRawEdges(data.edges);
      setSelectedEdge(prev => {
        if (!prev) return prev;
        return data.edges.find(edge => edge.source === prev.source && edge.target === prev.target && edge.kind === prev.kind) || null;
      });
      setError(null);
    } catch (e) {
      setError('Failed to load network graph');
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const scheduleGraphRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchGraph().catch(() => {});
    }, 500);
  }, [fetchGraph]);

  // Fetch graph data
  useEffect(() => {
    fetchGraph(true).catch(() => {});
  }, [fetchGraph]);

  // Live updates from chat, Mother Chat, tasks, and agent state changes
  useEffect(() => {
    const socket = getSocket();
    const events = ['agent:chat:event', 'mother-chat:event', 'agent:updated', 'agent:status', 'task:update', 'task:delete'];
    events.forEach(eventName => socket.on(eventName, scheduleGraphRefresh));
    return () => {
      events.forEach(eventName => socket.off(eventName, scheduleGraphRefresh));
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleGraphRefresh]);

  // Initialize simulation when data arrives
  useEffect(() => {
    if (rawNodes.length === 0) return;
    const { width, height } = sizeRef.current;
    nodesRef.current = initializeNodes(rawNodes, rawEdges, width, height);

    // Initialize particles along edges
    const particles: Particle[] = [];
    rawEdges.forEach((edge, i) => {
      const count = Math.min(Math.ceil(edge.messageCount / 3), 5);
      for (let p = 0; p < count; p++) {
        particles.push({
          edgeIndex: i,
          progress: Math.random(),
          speed: 0.002 + Math.random() * 0.004,
          forward: Math.random() > 0.5,
        });
      }
    });
    // Cap total particles
    particlesRef.current = particles.slice(0, MAX_PARTICLES);
  }, [rawNodes, rawEdges]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        sizeRef.current = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    if (rawNodes.length === 0) return;

    let frameCount = 0;
    function animate() {
      const nodes = nodesRef.current;
      const { width, height } = sizeRef.current;

      // Step physics
      stepSimulation(nodes, rawEdges, width, height);

      // Step particles
      for (const p of particlesRef.current) {
        p.progress += p.speed * (p.forward ? 1 : -1);
        if (p.progress > 1) { p.progress = 1; p.forward = false; }
        if (p.progress < 0) { p.progress = 0; p.forward = true; }
      }

      // Re-render every 2 frames for performance
      frameCount++;
      if (frameCount % 2 === 0) {
        forceRender((n) => n + 1);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [rawNodes, rawEdges]);

  // Click handler
  const handleNodeClick = useCallback(
    (node: SimNode) => {
      setSelectedEdge(null);
      setSelectedNode((prev) => (prev?.id === node.id ? null : node));
    },
    []
  );

  const nodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));

  if (loading) {
    return (
      <div>
        <Header title="Network Graph" subtitle="Agent communication topology" />
        <div className="flex items-center justify-center h-[calc(100vh-200px)] text-gray-500 text-sm">
          Loading network graph...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Header title="Network Graph" subtitle="Agent communication topology" />
        <div className="flex items-center justify-center h-[calc(100vh-200px)] text-red-400 text-sm">
          {error}
        </div>
      </div>
    );
  }

  const { width, height } = sizeRef.current;
  const nodes = nodesRef.current;
  const particles = particlesRef.current;
  const maxEdgeCount = Math.max(1, ...rawEdges.map((e) => e.messageCount));

  return (
    <div>
      <Header
        title="Network Graph"
        subtitle="Agent communication topology"
        action={
          <button
            type="button"
            onClick={() => fetchGraph().catch(() => {})}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-surface-850 text-gray-400 transition-colors hover:text-white"
            title="Refresh graph"
            aria-label="Refresh graph"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4">
        <div className="flex items-center gap-4">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-500">{status.charAt(0) + status.slice(1).toLowerCase()}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4">
          {Object.entries(EDGE_COLORS).map(([kind, color]) => (
            <div key={kind} className="flex items-center gap-1.5">
              <div className="w-5 h-[2px] rounded" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-500">{kind.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-600 ml-auto">
          Arrow = direction | Edge thickness = message frequency | Node size = activity level
        </div>
      </div>

      {/* Graph container */}
      <div
        ref={containerRef}
        className="relative rounded-xl border border-white/5 bg-surface-850 overflow-hidden"
        style={{ height: 'calc(100vh - 240px)', minHeight: 500 }}
      >
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="select-none"
        >
          {/* Subtle grid background */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
            </pattern>
            {/* Glow filter for nodes */}
            <filter id="glow">
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {Object.entries(EDGE_COLORS).map(([kind, color]) => (
              <marker
                key={kind}
                id={`arrow-${kind}`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill={color} />
              </marker>
            ))}
          </defs>
          <rect width={width} height={height} fill="url(#grid)" />

          {/* Edges */}
          {rawEdges.map((edge, i) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) return null;

            const thickness = 1 + (edge.messageCount / maxEdgeCount) * 5;
            const kind = edge.kind || 'system';
            const color = EDGE_COLORS[kind] ?? EDGE_COLORS.system;
            const isSelectedEdge =
              selectedEdge?.source === edge.source &&
              selectedEdge?.target === edge.target &&
              selectedEdge?.kind === edge.kind;
            const isHighlighted =
              isSelectedEdge ||
              hoveredNode === edge.source ||
              hoveredNode === edge.target ||
              selectedNode?.id === edge.source ||
              selectedNode?.id === edge.target;

            return (
              <line
                key={`edge-${edge.source}-${edge.target}-${edge.kind || 'system'}-${i}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isHighlighted ? color : 'rgba(255,255,255,0.08)'}
                strokeWidth={thickness}
                strokeLinecap="round"
                markerEnd={`url(#arrow-${kind})`}
                className="cursor-pointer transition-all duration-200"
                opacity={isHighlighted ? 0.85 : 0.35}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedNode(null);
                  setSelectedEdge(edge);
                }}
              />
            );
          })}

          {/* Animated particles */}
          {particles.map((p, i) => {
            const edge = rawEdges[p.edgeIndex];
            if (!edge) return null;
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) return null;

            const x = source.x + (target.x - source.x) * p.progress;
            const y = source.y + (target.y - source.y) * p.progress;

            return (
              <circle
                key={`particle-${i}`}
                cx={x}
                cy={y}
                r={2.5}
                fill="#3b8eff"
                opacity={0.7}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const color = STATUS_COLORS[node.status] ?? '#6b7280';
            const isSelected = selectedNode?.id === node.id;
            const isHovered = hoveredNode === node.id;
            const isDimmed =
              hoveredNode != null &&
              !isHovered &&
              !rawEdges.some(
                (e) =>
                  (e.source === hoveredNode && e.target === node.id) ||
                  (e.target === hoveredNode && e.source === node.id)
              );

            return (
              <g
                key={node.id}
                onClick={() => handleNodeClick(node)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer"
                opacity={isDimmed ? 0.3 : 1}
              >
                {/* Glow ring */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius + 6}
                  fill="none"
                  stroke={isSelected || isHovered ? color : 'transparent'}
                  strokeWidth={2}
                  opacity={0.5}
                />

                {/* Node background */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill="#0f172a"
                  stroke={color}
                  strokeWidth={isSelected ? 3 : 2}
                  filter={isHovered || isSelected ? 'url(#glow)' : undefined}
                />

                {/* Status dot */}
                <circle
                  cx={node.x + node.radius * 0.65}
                  cy={node.y - node.radius * 0.65}
                  r={5}
                  fill={color}
                  stroke="#0f172a"
                  strokeWidth={2}
                />

                {/* Avatar emoji */}
                <text
                  x={node.x}
                  y={node.y - 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={node.radius * 0.6}
                  style={{ pointerEvents: 'none' }}
                >
                  {node.avatar ?? '?'}
                </text>

                {/* Name label */}
                <text
                  x={node.x}
                  y={node.y + node.radius + 16}
                  textAnchor="middle"
                  fill={isHovered || isSelected ? '#e5e7eb' : '#9ca3af'}
                  fontSize={11}
                  fontWeight={isSelected ? 600 : 400}
                  style={{ pointerEvents: 'none' }}
                >
                  {node.displayName}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Detail panel */}
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            edges={rawEdges}
            allNodes={nodes}
            onClose={() => setSelectedNode(null)}
          />
        )}
        {selectedEdge && (
          <EdgeDetailPanel
            edge={selectedEdge}
            nodeMap={nodeMap}
            onClose={() => setSelectedEdge(null)}
          />
        )}

        {/* Info overlay */}
        <div className="absolute bottom-4 left-4 flex items-center gap-4 text-xs text-gray-600">
          <span>{rawNodes.length} agents</span>
          <span>{rawEdges.length} connections</span>
          <span>
            {rawEdges.reduce((s, e) => s + e.messageCount, 0)} total messages
          </span>
        </div>
      </div>
    </div>
  );
}
