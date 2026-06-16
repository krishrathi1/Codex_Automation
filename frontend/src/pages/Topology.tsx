import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { Maximize2, Minus, Plus, RefreshCw } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { timeAgo } from '@/lib/utils';
import type { Board } from '@/types';

// ─── Types ─────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  displayName: string;
  avatar: string | null;
  status: string;
  kind?: string;
  boardId?: string | null;
  boardName?: string | null;
  currentTask?: string | null;
  codexSessionId?: string;
  activeRunIds?: string[];
  queuedRunIds?: string[];
  failedRunIds?: string[];
  taskIds?: string[];
}

interface GraphEdge {
  source: string;
  target: string;
  kind?: 'admin_agent' | 'admin_mother' | 'agent_agent' | 'mother_observation' | 'system';
  label?: string;
  messageCount: number;
  lastMessage: string;
  boardId?: string | null;
  boardName?: string | null;
  threadIds?: string[];
  codexSessionIds?: string[];
  sessionIds?: string[];
  activeRunIds?: string[];
  queuedRunIds?: string[];
  failedRunIds?: string[];
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
    type: 'task' | 'session' | 'context' | 'run_job';
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
  anchorX: number;
  anchorY: number;
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
  admin_mother: '#3b82f6',
  agent_agent: '#10b981',
  mother_observation: '#f59e0b',
  system: '#64748b',
};

const REPULSION = 7000;
const ATTRACTION = 0.0008;
const CENTER_GRAVITY = 0.05;
const DAMPING = 0.72;
const MIN_NODE_RADIUS = 22;
const MAX_NODE_RADIUS = 46;
const MAX_PARTICLES = 60;
const LABEL_WIDTH = 150;
const LABEL_HEIGHT = 46;
const SVG_PADDING_X = 150;
const SVG_PADDING_TOP = 130;
const SVG_PADDING_BOTTOM = 130;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.4;
const ZOOM_STEP = 1.18;

// ─── Force Simulation ──────────────────────────────────

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nodeRank(node: GraphNode) {
  if (node.kind === 'admin') return 0;
  if (node.kind === 'mother_chat') return 1;
  return 2;
}

function compactName(value: string, max = 24) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function sortNodes(nodes: GraphNode[]) {
  return [...nodes].sort((a, b) => {
    const rankDelta = nodeRank(a) - nodeRank(b);
    if (rankDelta !== 0) return rankDelta;
    const boardDelta = (a.boardName || '').localeCompare(b.boardName || '');
    if (boardDelta !== 0) return boardDelta;
    return (a.displayName || a.name).localeCompare(b.displayName || b.name);
  });
}

function boardKey(node: GraphNode) {
  return node.boardId || 'organization';
}

function topologyKeyFromEdge(edge: GraphEdge, nodeMap: Map<string, GraphNode>) {
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  if (!source || !target) return false;
  if (source.kind === 'mother_chat' && target.kind === 'mother_chat') return false;

  return (
    edge.kind === 'admin_mother' &&
    source.kind === 'admin' &&
    target.kind === 'mother_chat'
  ) || (
    edge.kind === 'mother_observation' &&
    source.kind === 'mother_chat' &&
    target.kind === 'agent'
  );
}

function visibleTopologyEdges(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  return edges.filter(edge => topologyKeyFromEdge(edge, nodeMap));
}

function withUniqueVisibleNames(nodes: GraphNode[]) {
  const visibleCounts = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind === 'admin' || node.kind === 'mother_chat') continue;
    const key = (node.displayName || node.name).trim().toLowerCase();
    visibleCounts.set(key, (visibleCounts.get(key) ?? 0) + 1);
  }

  return nodes.map(node => {
    if (node.kind === 'admin' || node.kind === 'mother_chat') return node;
    const key = (node.displayName || node.name).trim().toLowerCase();
    if ((visibleCounts.get(key) ?? 0) <= 1) return node;
    const suffix = node.boardName || node.boardId?.slice(0, 6) || node.id.slice(0, 6);
    return {
      ...node,
      displayName: `${node.displayName || node.name} · ${suffix}`,
    };
  });
}

function layoutSizeFor(nodes: GraphNode[], viewportWidth: number, viewportHeight: number) {
  const mothers = nodes.filter(node => node.kind === 'mother_chat');
  const agents = nodes.filter(node => nodeRank(node) === 2);
  const groupKeys = new Set<string>([
    ...mothers.map(boardKey),
    ...agents.map(boardKey),
  ]);
  const groupCount = Math.max(1, groupKeys.size);
  const agentCounts = Array.from(groupKeys).map(key => agents.filter(node => boardKey(node) === key).length);
  const maxAgentsInGroup = Math.max(1, ...agentCounts);
  const ringRadius = 230 + Math.max(0, groupCount - 1) * 48 + Math.max(0, maxAgentsInGroup - 3) * 18;
  const agentRing = clamp(118 + maxAgentsInGroup * 10, 128, 240);
  const side = Math.ceil((ringRadius + agentRing + 190) * 2);

  return {
    width: Math.max(viewportWidth, 900, side),
    height: Math.max(viewportHeight, 680, side),
  };
}

function initializeNodes(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): SimNode[] {
  const activityMap = new Map<string, number>();
  for (const edge of edges) {
    activityMap.set(edge.source, (activityMap.get(edge.source) ?? 0) + edge.messageCount);
    activityMap.set(edge.target, (activityMap.get(edge.target) ?? 0) + edge.messageCount);
  }
  const maxActivity = Math.max(1, ...activityMap.values());
  const sorted = sortNodes(nodes);
  const agents = sorted.filter(node => nodeRank(node) === 2);
  const mothers = sorted.filter(node => node.kind === 'mother_chat');
  const admins = sorted.filter(node => node.kind === 'admin');
  const centerX = width / 2;
  const centerY = height / 2;
  const motherOrder = mothers.map(node => boardKey(node));
  const agentGroups = new Map<string, GraphNode[]>();
  agents.forEach((node) => {
    const key = boardKey(node);
    const group = agentGroups.get(key) ?? [];
    group.push(node);
    agentGroups.set(key, group);
    if (!motherOrder.includes(key)) motherOrder.push(key);
  });
  const groupCount = Math.max(1, motherOrder.length);
  const maxAgentsInGroup = Math.max(1, ...Array.from(agentGroups.values()).map(group => group.length));
  const motherRingRadius = 230 + Math.max(0, groupCount - 1) * 48 + Math.max(0, maxAgentsInGroup - 3) * 18;
  const density = nodes.length > 50 ? 0.72 : nodes.length > 34 ? 0.82 : nodes.length > 22 ? 0.9 : 1;

  function radiusFor(node: GraphNode) {
    const activity = activityMap.get(node.id) ?? 0;
    const normalized = activity / maxActivity;
    if (node.kind === 'admin') return 48 * density;
    if (node.kind === 'mother_chat') return (36 + normalized * 8) * density;
    return (MIN_NODE_RADIUS + normalized * (MAX_NODE_RADIUS - MIN_NODE_RADIUS)) * density;
  }

  function baseNode(node: GraphNode, x: number, y: number): SimNode {
    const activity = activityMap.get(node.id) ?? 0;
    return {
      ...node,
      x,
      y,
      anchorX: x,
      anchorY: y,
      vx: 0,
      vy: 0,
      radius: radiusFor(node),
      activity,
    };
  }

  const positioned: SimNode[] = [];
  admins.forEach((node, i) => {
    const offset = (i - (admins.length - 1) / 2) * 118;
    positioned.push(baseNode(node, centerX + offset, centerY));
  });

  const motherPositions = new Map<string, { x: number; y: number; angle: number }>();
  mothers.forEach((node) => {
    const index = Math.max(0, motherOrder.indexOf(boardKey(node)));
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / groupCount;
    const x = centerX + Math.cos(angle) * motherRingRadius;
    const y = centerY + Math.sin(angle) * motherRingRadius;
    motherPositions.set(boardKey(node), { x, y, angle });
    positioned.push(baseNode(
      node,
      clamp(x, SVG_PADDING_X, width - SVG_PADDING_X),
      clamp(y, SVG_PADDING_TOP, height - SVG_PADDING_BOTTOM)
    ));
  });

  motherOrder.forEach((key, groupIndex) => {
    const groupAgents = agentGroups.get(key) ?? [];
    const fallbackAngle = -Math.PI / 2 + (Math.PI * 2 * groupIndex) / groupCount;
    const mother = motherPositions.get(key) ?? {
      x: centerX + Math.cos(fallbackAngle) * motherRingRadius,
      y: centerY + Math.sin(fallbackAngle) * motherRingRadius,
      angle: fallbackAngle,
    };
    const agentRingRadius = clamp(118 + groupAgents.length * 10, 128, 240);
    const fanSpan = groupAgents.length <= 1
      ? 0
      : clamp(0.52 + groupAgents.length * 0.22, 0.86, Math.PI * 1.25);
    groupAgents.forEach((node, i) => {
      const offset = groupAgents.length <= 1
        ? 0
        : -fanSpan / 2 + (fanSpan * i) / (groupAgents.length - 1);
      const angle = mother.angle + offset;
      const x = mother.x + Math.cos(angle) * agentRingRadius;
      const y = mother.y + Math.sin(angle) * agentRingRadius;
      positioned.push(baseNode(
        node,
        clamp(x, SVG_PADDING_X, width - SVG_PADDING_X),
        clamp(y, SVG_PADDING_TOP, height - SVG_PADDING_BOTTOM)
      ));
    });
  });

  return positioned;
}

function stepSimulation(
  nodes: SimNode[],
  edges: GraphEdge[],
  width: number,
  height: number
): void {
  // Reset forces
  for (const node of nodes) {
    // Pull toward deterministic lane anchors instead of one shared center.
    node.vx += (node.anchorX - node.x) * CENTER_GRAVITY;
    node.vy += (node.anchorY - node.y) * CENTER_GRAVITY;
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
      const minDist = a.radius + b.radius + LABEL_HEIGHT + 16;
      const collisionBoost = dist < minDist ? 3 : 1;
      const force = (REPULSION * collisionBoost) / (dist * dist);
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
    const semanticWeight = edge.kind === 'agent_agent'
      ? 1
      : edge.kind === 'admin_mother'
        ? 0.25
        : edge.kind === 'mother_observation'
          ? 0.06
          : 0.18;
    const strength = ATTRACTION * semanticWeight * Math.log2(edge.messageCount + 1);
    const fx = dx * strength;
    const fy = dy * strength;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  // Apply velocities and damping
  const paddingX = SVG_PADDING_X - 24;
  const paddingY = SVG_PADDING_TOP - 40;
  for (const node of nodes) {
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;

    // Keep nodes within bounds
    node.x = Math.max(paddingX + node.radius, Math.min(width - paddingX - node.radius, node.x));
    node.y = Math.max(paddingY + node.radius, Math.min(height - SVG_PADDING_BOTTOM - node.radius, node.y));
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
  const activeRuns = node.activeRunIds?.length
    ? node.activeRunIds.length
    : 0;
  const queuedRuns = node.queuedRunIds?.length
    ? node.queuedRunIds.length
    : 0;
  const failedRuns = node.failedRunIds?.length
    ? node.failedRunIds.length
    : 0;

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
          {node.boardName && (
            <span className="rounded bg-nexus-500/10 px-2 py-0.5 text-[10px] font-medium text-nexus-300">
              {node.boardName}
            </span>
          )}
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
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <div className="text-xs text-gray-500">Active runs</div>
            <div className="text-lg font-bold text-white font-mono">{activeRuns}</div>
          </div>
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <div className="text-xs text-gray-500">Queued runs</div>
            <div className="text-lg font-bold text-white font-mono">{queuedRuns}</div>
          </div>
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <div className="text-xs text-gray-500">Failed runs</div>
            <div className="text-lg font-bold text-white font-mono">{failedRuns}</div>
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
                      {edge.boardName || 'Organization'} · Last: {timeAgo(edge.lastMessage)}
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
    { label: 'Queued runs', values: edge.queuedRunIds ?? [] },
    { label: 'Failed runs', values: edge.failedRunIds ?? [] },
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
          {edge.boardName && <span className="text-xs text-gray-500">{edge.boardName}</span>}
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
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
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
  const layoutSizeRef = useRef({ width: 900, height: 680 });
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [, forceRender] = useState(0);

  const fetchGraph = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setRefreshing(true);
    try {
      const data = await api.threads.graph(selectedBoardId ? { boardId: selectedBoardId } : undefined);
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
  }, [selectedBoardId]);

  useEffect(() => {
    api.boards.list()
      .then(setBoards)
      .catch((err) => console.error('Failed to load boards for topology filter', err));
  }, []);

  const scheduleGraphRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchGraph().catch(() => {});
    }, 500);
  }, [fetchGraph]);

  const graphNodes = useMemo(() => withUniqueVisibleNames(rawNodes), [rawNodes]);
  const topologyEdges = useMemo(() => visibleTopologyEdges(graphNodes, rawEdges), [graphNodes, rawEdges]);

  const fitViewport = useCallback(() => {
    const viewportSize = sizeRef.current;
    const layoutSize = layoutSizeRef.current;
    const scale = clamp(
      Math.min(
        viewportSize.width / Math.max(layoutSize.width, 1),
        viewportSize.height / Math.max(layoutSize.height, 1),
        1,
      ) * 0.94,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    setViewport({
      scale,
      x: (viewportSize.width - layoutSize.width * scale) / 2,
      y: (viewportSize.height - layoutSize.height * scale) / 2,
    });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const viewportSize = sizeRef.current;
    setViewport(prev => {
      const nextScale = clamp(prev.scale * factor, ZOOM_MIN, ZOOM_MAX);
      const centerX = viewportSize.width / 2;
      const centerY = viewportSize.height / 2;
      const worldX = (centerX - prev.x) / prev.scale;
      const worldY = (centerY - prev.y) / prev.scale;
      return {
        scale: nextScale,
        x: centerX - worldX * nextScale,
        y: centerY - worldY * nextScale,
      };
    });
  }, []);

  // Fetch graph data
  useEffect(() => {
    fetchGraph(true).catch(() => {});
  }, [fetchGraph]);

  // Live updates from chat, Mother Chat, tasks, and agent state changes
  useEffect(() => {
    const socket = getSocket();
    const events = ['agent:chat:event', 'mother-chat:event', 'agent:updated', 'agent:status', 'task:update', 'task:delete', 'agent-run-job:update'];
    events.forEach(eventName => socket.on(eventName, scheduleGraphRefresh));
    return () => {
      events.forEach(eventName => socket.off(eventName, scheduleGraphRefresh));
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleGraphRefresh]);

  // Initialize simulation when data arrives
  useEffect(() => {
    if (graphNodes.length === 0) return;
    const viewportSize = sizeRef.current;
    const layoutSize = layoutSizeFor(graphNodes, viewportSize.width, viewportSize.height);
    layoutSizeRef.current = layoutSize;
    nodesRef.current = initializeNodes(graphNodes, topologyEdges, layoutSize.width, layoutSize.height);
    fitViewport();

    // Initialize particles along edges
    const particles: Particle[] = [];
    topologyEdges.forEach((edge, i) => {
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
  }, [graphNodes, topologyEdges, fitViewport]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextSize = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
        const previous = sizeRef.current;
        sizeRef.current = nextSize;
        const changed = Math.abs(previous.width - nextSize.width) > 4 || Math.abs(previous.height - nextSize.height) > 4;
        if (changed && graphNodes.length > 0) {
          const layoutSize = layoutSizeFor(graphNodes, nextSize.width, nextSize.height);
          layoutSizeRef.current = layoutSize;
          nodesRef.current = initializeNodes(graphNodes, topologyEdges, layoutSize.width, layoutSize.height);
          fitViewport();
          forceRender((n) => n + 1);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [graphNodes, topologyEdges, fitViewport]);

  // Animation loop
  useEffect(() => {
    if (graphNodes.length === 0) return;

    let frameCount = 0;
    function animate() {
      const nodes = nodesRef.current;
      const { width, height } = layoutSizeRef.current;

      // Step physics
      stepSimulation(nodes, topologyEdges, width, height);

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
  }, [graphNodes, topologyEdges]);

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
  const layoutSize = layoutSizeRef.current;
  const nodes = nodesRef.current;
  const particles = particlesRef.current;
  const maxEdgeCount = Math.max(1, ...topologyEdges.map((e) => e.messageCount));

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest('[data-graph-interactive="true"]')) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setViewport(prev => ({
      ...prev,
      x: pan.originX + event.clientX - pan.startX,
      y: pan.originY + event.clientY - pan.startY,
    }));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setViewport(prev => {
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const nextScale = clamp(prev.scale * factor, ZOOM_MIN, ZOOM_MAX);
      const worldX = (pointerX - prev.x) / prev.scale;
      const worldY = (pointerY - prev.y) / prev.scale;
      return {
        scale: nextScale,
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
      };
    });
  }

  return (
    <div>
      <Header
        title="Network Graph"
        subtitle={selectedBoardId ? 'Scoped group topology' : 'Isolated group communication topology'}
        action={
          <div className="flex items-center gap-2">
            <select
              value={selectedBoardId}
              onChange={(event) => setSelectedBoardId(event.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-surface-850 px-3 text-sm text-gray-200 outline-none transition-colors focus:border-nexus-500"
              aria-label="Filter network graph by production group"
            >
              <option value="">All groups</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>{board.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => fetchGraph().catch(() => {})}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-surface-850 text-gray-400 transition-colors hover:text-white"
              title="Refresh graph"
              aria-label="Refresh graph"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
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
          {[
            ['admin_mother', 'admin -> mother'],
            ['mother_observation', 'mother -> sub-agent'],
          ].map(([kind, label]) => (
            <div key={kind} className="flex items-center gap-1.5">
              <div className="w-5 h-[2px] rounded" style={{ backgroundColor: EDGE_COLORS[kind] }} />
              <span className="text-xs text-gray-500">{label}</span>
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
        <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-surface-900/90 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_STEP)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={fitViewport}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Fit graph"
            title="Fit graph"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="select-none touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
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
          <rect width={width} height={height} fill="#0b1120" />

          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            <rect width={layoutSize.width} height={layoutSize.height} fill="url(#grid)" />

            {/* Group scopes */}
            <g opacity={0.5}>
              {nodes.filter(node => node.kind === 'mother_chat').map((mother) => {
                const scopedAgents = nodes.filter(node => node.kind === 'agent' && boardKey(node) === boardKey(mother));
                const maxDistance = Math.max(
                  128,
                  ...scopedAgents.map(agent => Math.hypot(agent.x - mother.x, agent.y - mother.y) + agent.radius + 24),
                );
                return (
                  <g key={`scope-${mother.id}`}>
                    <circle
                      cx={mother.x}
                      cy={mother.y}
                      r={maxDistance}
                      fill="rgba(59,130,246,0.035)"
                      stroke="rgba(96,165,250,0.14)"
                      strokeDasharray="7 8"
                    />
                    <text
                      x={mother.x}
                      y={mother.y - maxDistance - 12}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize={12}
                      fontWeight={700}
                      letterSpacing={0}
                    >
                      {(mother.boardName || mother.displayName).toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </g>

          {/* Edges */}
          {topologyEdges.map((edge, i) => {
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
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const ox = dx / dist;
            const oy = dy / dist;
            const x1 = source.x + ox * (source.radius + 4);
            const y1 = source.y + oy * (source.radius + 4);
            const x2 = target.x - ox * (target.radius + 10);
            const y2 = target.y - oy * (target.radius + 10);

            return (
              <line
                key={`edge-${edge.source}-${edge.target}-${edge.kind || 'system'}-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isHighlighted ? color : 'rgba(255,255,255,0.08)'}
                strokeWidth={isHighlighted ? thickness + 1 : Math.min(thickness, 2.5)}
                strokeLinecap="round"
                markerEnd={`url(#arrow-${kind})`}
                data-graph-interactive="true"
                className="cursor-pointer transition-all duration-200"
                opacity={isHighlighted ? 0.9 : 0.22}
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
            const edge = topologyEdges[p.edgeIndex];
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
              !topologyEdges.some(
                (e) =>
                  (e.source === hoveredNode && e.target === node.id) ||
                  (e.target === hoveredNode && e.source === node.id)
              );
            const label = compactName(node.displayName || node.name);

            return (
              <g
                key={node.id}
                data-graph-interactive="true"
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
                <foreignObject
                  x={clamp(node.x - LABEL_WIDTH / 2, 8, layoutSize.width - LABEL_WIDTH - 8)}
                  y={node.y + node.radius + 8}
                  width={LABEL_WIDTH}
                  height={LABEL_HEIGHT}
                  style={{ pointerEvents: 'none' }}
                >
                  <div
                    title={node.displayName}
                    className="h-full overflow-hidden text-center text-[11px] leading-tight"
                    style={{
                      color: isHovered || isSelected ? '#e5e7eb' : '#9ca3af',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    <div className="truncate">{label}</div>
                    {node.codexSessionId && (
                      <div className="mt-0.5 truncate font-mono text-[9px] text-gray-600">
                        {node.codexSessionId.slice(0, 8)}
                      </div>
                    )}
                  </div>
                </foreignObject>
              </g>
            );
          })}
          </g>
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
          <span>{graphNodes.length} nodes</span>
          <span>{topologyEdges.length} visible connections</span>
          <span>{rawEdges.length - topologyEdges.length} audit links hidden</span>
          <span>
            {rawEdges.reduce((s, e) => s + e.messageCount, 0)} total messages
          </span>
        </div>
      </div>
    </div>
  );
}
