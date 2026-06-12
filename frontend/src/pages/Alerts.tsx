import { useEffect, useState, useCallback } from 'react';
import { Header } from '../components/layout/Header';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import type { AlertRule, AlertEvent, Severity } from '@/types';

const severityConfig: Record<Severity, { color: string; bg: string; border: string; label: string }> = {
  INFO: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Info' },
  WARNING: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Warning' },
  CRITICAL: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Critical' },
};

export function Alerts() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<Severity | 'ALL'>('ALL');
  const [ackFilter, setAckFilter] = useState<'all' | 'unacknowledged' | 'acknowledged'>('all');
  const [showAddRule, setShowAddRule] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [evts, rls] = await Promise.all([api.alerts.events(), api.alerts.rules()]);
      setEvents(evts);
      setRules(rls);
    } catch (err) {
      console.error('Failed to fetch alert data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAcknowledge = async (id: string) => {
    try {
      const updated = await api.alerts.acknowledge(id);
      setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      const updated = await api.alerts.updateRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const handleCreateRule = async (data: {
    name: string;
    condition: string;
    threshold: number;
    windowMinutes: number;
  }) => {
    try {
      const rule = await api.alerts.createRule(data);
      setRules((prev) => [rule, ...prev]);
      setShowAddRule(false);
    } catch (err) {
      console.error('Failed to create rule:', err);
    }
  };

  // Counts for the banner
  const unacknowledged = events.filter((e) => !e.acknowledged);
  const criticalCount = unacknowledged.filter((e) => e.severity === 'CRITICAL').length;
  const warningCount = unacknowledged.filter((e) => e.severity === 'WARNING').length;
  const infoCount = unacknowledged.filter((e) => e.severity === 'INFO').length;

  // Filtered events
  const filteredEvents = events.filter((e) => {
    if (severityFilter !== 'ALL' && e.severity !== severityFilter) return false;
    if (ackFilter === 'unacknowledged' && e.acknowledged) return false;
    if (ackFilter === 'acknowledged' && !e.acknowledged) return false;
    return true;
  });

  if (loading) {
    return (
      <div>
        <Header title="Alerts" subtitle="Monitor alert rules and events" />
        <div className="text-gray-500 text-sm mt-8">Loading alert data...</div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Alerts" subtitle="Monitor alert rules and events" />

      {/* Active Alerts Banner */}
      {unacknowledged.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-surface-850 p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse-dot" />
              <span className="text-sm font-medium text-white">
                {unacknowledged.length} Unacknowledged Alert{unacknowledged.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {criticalCount > 0 && (
                <span className="px-2 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 font-medium">
                  {criticalCount} Critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium">
                  {warningCount} Warning
                </span>
              )}
              {infoCount > 0 && (
                <span className="px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-400 font-medium">
                  {infoCount} Info
                </span>
              )}
            </div>
          </div>
          <button
            onClick={async () => {
              for (const e of unacknowledged) {
                await handleAcknowledge(e.id);
              }
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-colors"
          >
            Acknowledge All
          </button>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-5 gap-6">
        {/* Left: Alert Events (3 columns) */}
        <div className="col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Alert Events</h3>
            <div className="flex items-center gap-2">
              {/* Severity filter */}
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as Severity | 'ALL')}
                className="text-xs bg-surface-900 border border-white/10 text-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-nexus-500/50"
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Info</option>
              </select>

              {/* Acknowledged filter */}
              <select
                value={ackFilter}
                onChange={(e) => setAckFilter(e.target.value as 'all' | 'unacknowledged' | 'acknowledged')}
                className="text-xs bg-surface-900 border border-white/10 text-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-nexus-500/50"
              >
                <option value="all">All Status</option>
                <option value="unacknowledged">Unacknowledged</option>
                <option value="acknowledged">Acknowledged</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
            {filteredEvents.length === 0 ? (
              <div className="text-center text-gray-500 py-12 text-sm">No alert events match the current filters</div>
            ) : (
              filteredEvents.map((event) => (
                <EventCard key={event.id} event={event} onAcknowledge={handleAcknowledge} />
              ))
            )}
          </div>
        </div>

        {/* Right: Alert Rules (2 columns) */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Alert Rules</h3>
            <button
              onClick={() => setShowAddRule(true)}
              className="px-3 py-1.5 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <span className="text-sm leading-none">+</span>
              Add Rule
            </button>
          </div>

          <div className="space-y-2">
            {rules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} onToggle={handleToggleRule} />
            ))}
            {rules.length === 0 && (
              <div className="text-center text-gray-500 py-12 text-sm">No alert rules configured</div>
            )}
          </div>
        </div>
      </div>

      {/* Add Rule Modal */}
      {showAddRule && <AddRuleModal onClose={() => setShowAddRule(false)} onSubmit={handleCreateRule} />}
    </div>
  );
}

function EventCard({
  event,
  onAcknowledge,
}: {
  event: AlertEvent;
  onAcknowledge: (id: string) => void;
}) {
  const sev = severityConfig[event.severity];

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors',
        event.acknowledged ? 'border-white/5 bg-surface-900' : 'border-white/10 bg-surface-850'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Pulsing indicator for unacknowledged */}
        <div className="mt-1 flex-shrink-0">
          {!event.acknowledged ? (
            <div className={cn('w-2.5 h-2.5 rounded-full animate-pulse-dot', {
              'bg-red-500': event.severity === 'CRITICAL',
              'bg-amber-500': event.severity === 'WARNING',
              'bg-blue-500': event.severity === 'INFO',
            })} />
          ) : (
            <div className="w-2.5 h-2.5 rounded-full bg-gray-700" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Severity badge */}
            <span className={cn('px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border', sev.bg, sev.border, sev.color)}>
              {sev.label}
            </span>
            {event.alertRule && (
              <span className="text-xs text-gray-500 truncate">{event.alertRule.name}</span>
            )}
          </div>

          <p className={cn('text-sm mb-1.5', event.acknowledged ? 'text-gray-500' : 'text-gray-300')}>
            {event.message}
          </p>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">{timeAgo(event.createdAt)}</span>
            {!event.acknowledged && (
              <button
                onClick={() => onAcknowledge(event.id)}
                className="text-xs text-nexus-400 hover:text-nexus-300 font-medium transition-colors"
              >
                Acknowledge
              </button>
            )}
            {event.acknowledged && event.acknowledgedAt && (
              <span className="text-xs text-gray-600">
                Acknowledged {timeAgo(event.acknowledgedAt)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  onToggle,
}: {
  rule: AlertRule;
  onToggle: (rule: AlertRule) => void;
}) {
  return (
    <div className={cn('rounded-lg border p-4', rule.enabled ? 'border-white/10 bg-surface-850' : 'border-white/5 bg-surface-900 opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-white truncate">{rule.name}</h4>
            {rule._count && (
              <span className="text-[10px] text-gray-500 px-1.5 py-0.5 rounded bg-white/5">
                {rule._count.events} event{rule._count.events !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {rule.description && (
            <p className="text-xs text-gray-500 mb-2 line-clamp-2">{rule.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span>
              Condition: <span className="text-gray-400">{rule.condition}</span>
            </span>
            {rule.threshold !== null && rule.threshold !== undefined && (
              <span>
                Threshold: <span className="text-gray-400">{rule.threshold}</span>
              </span>
            )}
            <span>
              Window: <span className="text-gray-400">{rule.windowMinutes}m</span>
            </span>
          </div>
          {rule.agent && (
            <div className="text-xs text-gray-600 mt-1">
              Agent: <span className="text-gray-400">{rule.agent.displayName}</span>
            </div>
          )}
        </div>

        {/* Toggle switch */}
        <button
          onClick={() => onToggle(rule)}
          className={cn(
            'relative w-10 h-5 rounded-full transition-colors flex-shrink-0 mt-0.5',
            rule.enabled ? 'bg-nexus-600' : 'bg-gray-700'
          )}
        >
          <div
            className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              rule.enabled ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
        </button>
      </div>
    </div>
  );
}

function AddRuleModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; condition: string; threshold: number; windowMinutes: number }) => void;
}) {
  const [name, setName] = useState('');
  const [condition, setCondition] = useState('error_rate');
  const [threshold, setThreshold] = useState(3);
  const [windowMinutes, setWindowMinutes] = useState(5);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), condition, threshold, windowMinutes });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-850 border border-white/10 rounded-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold text-white mb-4">Create Alert Rule</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. High Error Rate"
              className="w-full px-3 py-2 bg-surface-900 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-nexus-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="w-full px-3 py-2 bg-surface-900 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-nexus-500/50"
            >
              <option value="error_rate">Error Rate</option>
              <option value="heartbeat_missed">Heartbeat Missed</option>
              <option value="offline">Agent Offline</option>
              <option value="high_response_time">High Response Time</option>
              <option value="high_cost">High Cost</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Threshold</label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full px-3 py-2 bg-surface-900 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-nexus-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Window (minutes)</label>
              <input
                type="number"
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 bg-surface-900 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-nexus-500/50"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Create Rule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
