import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow } from 'date-fns';
import type { AgentStatus, ActivityType, Priority } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(date: string | null): string {
  if (!date) return 'Never';
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/**
 * Strips common Markdown formatting markers so raw text (e.g. agent output)
 * renders cleanly in compact, plain-text UI like the activity feed.
 */
export function stripMarkdown(input: string): string {
  if (!input) return '';
  return input
    // fenced/inline code: drop the backticks, keep the content
    .replace(/```[a-zA-Z0-9]*\n?/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // images and links: keep the visible text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // bold / italic / strikethrough
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    // headings, blockquotes, and list bullets at line starts
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    // collapse whitespace into single spaces
    .replace(/\s+/g, ' ')
    .trim();
}

export const statusColors: Record<AgentStatus, string> = {
  ONLINE: 'bg-emerald-500',
  IDLE: 'bg-amber-500',
  OFFLINE: 'bg-gray-500',
  ERROR: 'bg-red-500',
};

export const statusTextColors: Record<AgentStatus, string> = {
  ONLINE: 'text-emerald-400',
  IDLE: 'text-amber-400',
  OFFLINE: 'text-gray-400',
  ERROR: 'text-red-400',
};

export const activityTypeColors: Record<ActivityType, string> = {
  HEARTBEAT: 'text-blue-400',
  TASK_START: 'text-violet-400',
  TASK_COMPLETE: 'text-emerald-400',
  ERROR: 'text-red-400',
  MESSAGE: 'text-sky-400',
  DELEGATION: 'text-amber-400',
  ALERT: 'text-orange-400',
  SYSTEM: 'text-gray-400',
};

export const activityTypeBgColors: Record<ActivityType, string> = {
  HEARTBEAT: 'bg-blue-500/10 border-blue-500/20',
  TASK_START: 'bg-violet-500/10 border-violet-500/20',
  TASK_COMPLETE: 'bg-emerald-500/10 border-emerald-500/20',
  ERROR: 'bg-red-500/10 border-red-500/20',
  MESSAGE: 'bg-sky-500/10 border-sky-500/20',
  DELEGATION: 'bg-amber-500/10 border-amber-500/20',
  ALERT: 'bg-orange-500/10 border-orange-500/20',
  SYSTEM: 'bg-gray-500/10 border-gray-500/20',
};

export const activityTypeIcons: Record<ActivityType, string> = {
  HEARTBEAT: '💓',
  TASK_START: '🚀',
  TASK_COMPLETE: '✅',
  ERROR: '❌',
  MESSAGE: '💬',
  DELEGATION: '📨',
  ALERT: '⚠️',
  SYSTEM: '⚙️',
};

export const priorityColors: Record<Priority, string> = {
  LOW: 'text-gray-400 bg-gray-500/10',
  MEDIUM: 'text-blue-400 bg-blue-500/10',
  HIGH: 'text-orange-400 bg-orange-500/10',
  CRITICAL: 'text-red-400 bg-red-500/10',
};
