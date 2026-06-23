import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from '../components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { getSocket } from '@/lib/socket';
import type { Thread, Message, CommEdge } from '@/types';

interface GraphNode {
  id: string;
  name: string;
  displayName: string;
  avatar: string | null;
  status: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: CommEdge[];
}

// ─── Communication Graph (SVG) ─────────────────────────────

function CommGraph({
  data,
  selectedNodeId,
  onSelectNode,
}: {
  data: GraphData;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const width = 500;
  const height = 460;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 60;

  // Position nodes in a radial layout
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const count = data.nodes.length;
    data.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      positions.set(node.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });
    return positions;
  }, [data.nodes, centerX, centerY, radius]);

  // Calculate max message count for line thickness scaling
  const maxMessages = useMemo(
    () => data.edges.reduce((m, e) => Math.max(m, e.messageCount), 1),
    [data.edges],
  );

  // Determine which edges and nodes are highlighted
  const activeNodeId = hoveredNode ?? selectedNodeId;
  const connectedNodeIds = useMemo(() => {
    if (!activeNodeId) return null;
    const ids = new Set<string>([activeNodeId]);
    for (const edge of data.edges) {
      if (edge.source === activeNodeId) ids.add(edge.target);
      if (edge.target === activeNodeId) ids.add(edge.source);
    }
    return ids;
  }, [activeNodeId, data.edges]);

  const isEdgeHighlighted = useCallback(
    (edge: CommEdge) => {
      if (!activeNodeId) return true;
      return edge.source === activeNodeId || edge.target === activeNodeId;
    },
    [activeNodeId],
  );

  const isNodeHighlighted = useCallback(
    (nodeId: string) => {
      if (!connectedNodeIds) return true;
      return connectedNodeIds.has(nodeId);
    },
    [connectedNodeIds],
  );

  const statusColor = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return '#10b981';
      case 'IDLE':
        return '#f59e0b';
      case 'ERROR':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      style={{ minHeight: 400 }}
    >
      <defs>
        {/* Animated pulse for active edges */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Edges */}
      {data.edges.map((edge) => {
        const from = nodePositions.get(edge.source);
        const to = nodePositions.get(edge.target);
        if (!from || !to) return null;

        const highlighted = isEdgeHighlighted(edge);
        const thickness = 1 + (edge.messageCount / maxMessages) * 5;

        return (
          <line
            key={`${edge.source}-${edge.target}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={highlighted ? '#3b8eff' : '#1e293b'}
            strokeWidth={thickness}
            strokeOpacity={highlighted ? 0.7 : 0.15}
            filter={highlighted && activeNodeId ? 'url(#glow)' : undefined}
            className="transition-all duration-300"
          >
            {highlighted && activeNodeId && (
              <animate
                attributeName="stroke-opacity"
                values="0.4;0.8;0.4"
                dur="2s"
                repeatCount="indefinite"
              />
            )}
          </line>
        );
      })}

      {/* Edge message count labels */}
      {data.edges.map((edge) => {
        const from = nodePositions.get(edge.source);
        const to = nodePositions.get(edge.target);
        if (!from || !to) return null;
        if (!isEdgeHighlighted(edge) || !activeNodeId) return null;

        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;

        return (
          <text
            key={`label-${edge.source}-${edge.target}`}
            x={mx}
            y={my - 6}
            textAnchor="middle"
            className="fill-nexus-400 text-[10px] font-medium pointer-events-none"
          >
            {edge.messageCount}
          </text>
        );
      })}

      {/* Nodes */}
      {data.nodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        const highlighted = isNodeHighlighted(node.id);
        const isSelected = selectedNodeId === node.id;
        const isHovered = hoveredNode === node.id;

        return (
          <g
            key={node.id}
            transform={`translate(${pos.x}, ${pos.y})`}
            className="cursor-pointer"
            onMouseEnter={() => setHoveredNode(node.id)}
            onMouseLeave={() => setHoveredNode(null)}
            onClick={() => onSelectNode(selectedNodeId === node.id ? null : node.id)}
            opacity={highlighted ? 1 : 0.25}
          >
            {/* Outer ring for selection */}
            {isSelected && (
              <circle
                r={28}
                fill="none"
                stroke="#3b8eff"
                strokeWidth={2}
                strokeDasharray="4 2"
                className="animate-spin"
                style={{ animationDuration: '8s' }}
              />
            )}

            {/* Node circle */}
            <circle
              r={22}
              fill={isHovered || isSelected ? '#1e293b' : '#0f172a'}
              stroke={isSelected ? '#3b8eff' : isHovered ? '#59b0ff' : '#1e293b'}
              strokeWidth={isSelected || isHovered ? 2 : 1}
              className="transition-all duration-200"
            />

            {/* Status indicator */}
            <circle
              cx={15}
              cy={-15}
              r={4}
              fill={statusColor(node.status)}
              stroke="#0f172a"
              strokeWidth={1.5}
            />

            {/* Avatar emoji or first letter */}
            <text
              textAnchor="middle"
              dominantBaseline="central"
              className="text-base pointer-events-none select-none"
              fontSize={node.avatar ? 18 : 14}
              fill={node.avatar ? undefined : '#9ca3af'}
            >
              {node.avatar || node.displayName[0]}
            </text>

            {/* Name label below */}
            <text
              y={34}
              textAnchor="middle"
              className="fill-gray-400 text-[10px] font-medium pointer-events-none"
            >
              {node.displayName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Message Bubble ─────────────────────────────────────────

function MessageBubble({ message, isFromSender }: { message: Message; isFromSender: boolean }) {
  return (
    <div className={cn('flex gap-3 max-w-[85%]', isFromSender ? 'self-start' : 'self-end flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm',
          isFromSender
            ? 'bg-nexus-600/20 border border-nexus-500/30'
            : 'bg-violet-600/20 border border-violet-500/30',
        )}
      >
        {message.sender.avatar || message.sender.displayName[0]}
      </div>

      {/* Content */}
      <div>
        <div className={cn('flex items-center gap-2 mb-1', !isFromSender && 'flex-row-reverse')}>
          <span className="text-xs font-medium text-gray-300">{message.sender.displayName}</span>
          <span className="text-[10px] text-gray-600">{timeAgo(message.createdAt)}</span>
        </div>
        <div
          className={cn(
            'rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
            isFromSender
              ? 'bg-surface-800 border border-white/5 text-gray-300 rounded-tl-sm'
              : 'bg-nexus-600/15 border border-nexus-500/20 text-gray-200 rounded-tr-sm',
          )}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}

// ─── Thread Card ────────────────────────────────────────────

function ThreadCard({
  thread,
  isActive,
  onClick,
}: {
  thread: Thread;
  isActive: boolean;
  onClick: () => void;
}) {
  const participants = useMemo(() => {
    const map = new Map<string, { displayName: string; avatar: string | null }>();
    for (const msg of thread.messages) {
      if (!map.has(msg.sender.id)) {
        map.set(msg.sender.id, { displayName: msg.sender.displayName, avatar: msg.sender.avatar });
      }
      if (!map.has(msg.receiver.id)) {
        map.set(msg.receiver.id, { displayName: msg.receiver.displayName, avatar: msg.receiver.avatar });
      }
    }
    return Array.from(map.values());
  }, [thread.messages]);

  const lastMessage = thread.messages[thread.messages.length - 1];

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border p-4 transition-all duration-200',
        isActive
          ? 'bg-nexus-600/10 border-nexus-500/30 shadow-lg shadow-nexus-500/5'
          : 'bg-surface-850 border-white/5 hover:border-white/10 hover:bg-surface-800',
      )}
    >
      {/* Title + time */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-white truncate">
          {thread.title || 'Untitled Thread'}
        </h4>
        <span className="text-[10px] text-gray-600 flex-shrink-0 mt-0.5">
          {timeAgo(thread.updatedAt)}
        </span>
      </div>

      {/* Participants */}
      <div className="flex items-center gap-1.5 mb-2">
        {participants.slice(0, 4).map((p, i) => (
          <div
            key={i}
            className="w-5 h-5 rounded-full bg-surface-900 border border-white/10 flex items-center justify-center text-[10px]"
            title={p.displayName}
          >
            {p.avatar || p.displayName[0]}
          </div>
        ))}
        {participants.length > 4 && (
          <span className="text-[10px] text-gray-600">+{participants.length - 4}</span>
        )}
        <span className="text-[10px] text-gray-500 ml-1">
          {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Last message preview */}
      {lastMessage && (
        <p className="text-xs text-gray-500 truncate">
          <span className="text-gray-400">{lastMessage.sender.displayName}:</span>{' '}
          {lastMessage.content}
        </p>
      )}
    </button>
  );
}

// ─── Thread Detail View ─────────────────────────────────────

function ThreadDetail({ thread }: { thread: Thread }) {
  // Identify the "first sender" to determine alignment
  const firstSenderId = thread.messages[0]?.senderId;

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div>
          <h3 className="text-sm font-semibold text-white">
            {thread.title || 'Untitled Thread'}
          </h3>
          <p className="text-[10px] text-gray-600 mt-0.5">
            {thread.messages.length} messages - started {timeAgo(thread.createdAt)}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 flex flex-col">
        {thread.messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isFromSender={msg.senderId === firstSenderId}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Communications Page ───────────────────────────────

export function Communications() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [threadList, graph] = await Promise.all([
        api.threads.list(),
        api.threads.graph(),
      ]);
      setThreads(threadList);
      setGraphData(graph);
    } catch (err) {
      console.error('Failed to load communications data:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Real-time updates: refresh when new A2A messages arrive
  useEffect(() => {
    const s = getSocket();

    const handleThreadMessage = () => {
      loadData();
    };

    s.on('thread:message', handleThreadMessage);
    s.on('agent:message', handleThreadMessage);

    return () => {
      s.off('thread:message', handleThreadMessage);
      s.off('agent:message', handleThreadMessage);
    };
  }, [loadData]);

  // Filter threads by selected graph node (agent)
  const filteredThreads = useMemo(() => {
    if (!selectedNodeId) return threads;
    return threads.filter((thread) =>
      thread.messages.some(
        (msg) => msg.senderId === selectedNodeId || msg.receiverId === selectedNodeId,
      ),
    );
  }, [threads, selectedNodeId]);

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  const selectedAgentName = useMemo(() => {
    if (!selectedNodeId) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId)?.displayName ?? null;
  }, [selectedNodeId, graphData.nodes]);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)]">
      <Header title="Communications" subtitle="Inter-agent message threads and communication topology" />

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 text-sm">Loading communications...</div>
        </div>
      ) : (
        <div className="flex-1 flex gap-6 min-h-0 pb-6">
          {/* ─── Left: Thread List & Detail (60%) ─── */}
          <div className="w-[60%] flex flex-col min-h-0">
            {/* Thread list / detail toggle */}
            {selectedThread ? (
              <div className="flex-1 flex flex-col rounded-xl border border-white/5 bg-surface-850 overflow-hidden">
                {/* Back button */}
                <button
                  onClick={() => setSelectedThreadId(null)}
                  className="flex items-center gap-2 px-5 py-3 text-xs text-gray-500 hover:text-gray-300 transition-colors border-b border-white/5 bg-surface-900"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back to threads
                </button>
                <ThreadDetail thread={selectedThread} />
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                      Threads
                    </h3>
                    {selectedAgentName && (
                      <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-nexus-600/10 border border-nexus-500/20">
                        <span className="text-[10px] text-nexus-400">
                          Filtered: {selectedAgentName}
                        </span>
                        <button
                          onClick={() => setSelectedNodeId(null)}
                          className="text-nexus-500 hover:text-nexus-300 transition-colors"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                            <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-600">
                    {filteredThreads.length} thread{filteredThreads.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {filteredThreads.length === 0 ? (
                    <div className="text-center text-gray-600 py-16 text-sm">
                      {selectedNodeId
                        ? 'No threads found for this agent'
                        : 'No communication threads yet'}
                    </div>
                  ) : (
                    filteredThreads.map((thread) => (
                      <ThreadCard
                        key={thread.id}
                        thread={thread}
                        isActive={false}
                        onClick={() => setSelectedThreadId(thread.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ─── Right: Communication Graph (40%) ─── */}
          <div className="w-[40%] flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                Topology
              </h3>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-nexus-500 animate-pulse-dot" />
                <span className="text-[10px] text-gray-600">
                  {graphData.nodes.length} agents - {graphData.edges.length} connections
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 rounded-xl border border-white/5 bg-surface-850 p-4 flex flex-col">
              {graphData.nodes.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-600">
                  No communication data yet
                </div>
              ) : (
                <div className="flex-1 min-h-0">
                  <CommGraph
                    data={graphData}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                  />
                </div>
              )}

              {/* Legend */}
              <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-center gap-5">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-gray-500">Online</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-[10px] text-gray-500">Idle</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-gray-500" />
                  <span className="text-[10px] text-gray-500">Offline</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-[2px] bg-nexus-500 rounded" />
                  <span className="text-[10px] text-gray-500">Messages</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
