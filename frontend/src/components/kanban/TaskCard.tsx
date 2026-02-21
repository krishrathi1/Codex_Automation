import { Draggable } from '@hello-pangea/dnd';
import type { Task } from '../../types';
import { priorityColors, timeAgo } from '../../lib/utils';

export function TaskCard({ task, index, onDelete }: { task: Task; index: number; onDelete: (id: string) => void }) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`rounded-lg border p-3 mb-2 transition-all ${
            snapshot.isDragging
              ? 'bg-surface-700 border-nexus-500/40 shadow-lg shadow-nexus-500/10 rotate-2'
              : 'bg-surface-850 border-white/5 hover:border-white/10'
          }`}
        >
          {/* Priority + Delete */}
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${priorityColors[task.priority]}`}>
              {task.priority}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
              className="text-gray-600 hover:text-red-400 transition-colors text-xs"
            >
              ✕
            </button>
          </div>

          {/* Title */}
          <h4 className="text-sm font-medium text-white mb-1">{task.title}</h4>

          {/* Description */}
          {task.description && (
            <p className="text-xs text-gray-500 mb-2 line-clamp-2">{task.description}</p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            {task.agent ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs">{task.agent.avatar}</span>
                <span className="text-xs text-gray-400">{task.agent.displayName}</span>
              </div>
            ) : (
              <span className="text-xs text-gray-600">Unassigned</span>
            )}
            <span className="text-[10px] text-gray-600">{timeAgo(task.updatedAt)}</span>
          </div>
        </div>
      )}
    </Draggable>
  );
}
