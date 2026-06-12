import { Droppable } from '@hello-pangea/dnd';
import type { Task, TaskStatus } from '../../types';
import { TaskCard } from './TaskCard';
import { cn } from '../../lib/utils';

const columnStyles: Record<TaskStatus, { bg: string; border: string; dot: string }> = {
  BACKLOG: { bg: 'bg-gray-500/5', border: 'border-gray-500/20', dot: 'bg-gray-500' },
  ASSIGNED: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', dot: 'bg-blue-500' },
  IN_PROGRESS: { bg: 'bg-violet-500/5', border: 'border-violet-500/20', dot: 'bg-violet-500' },
  REVIEW: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', dot: 'bg-amber-500' },
  DONE: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', dot: 'bg-emerald-500' },
};

const columnLabels: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  DONE: 'Done',
};

export function Column({
  status,
  tasks,
  onDelete,
}: {
  status: TaskStatus;
  tasks: Task[];
  onDelete: (id: string) => void;
}) {
  const style = columnStyles[status];

  return (
    <div className={cn('rounded-xl border p-3 min-h-[400px]', style.bg, style.border)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className={cn('w-2.5 h-2.5 rounded-full', style.dot)} />
          <span className="text-sm font-semibold text-white">{columnLabels[status]}</span>
        </div>
        <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">{tasks.length}</span>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'min-h-[300px] rounded-lg transition-colors p-1',
              snapshot.isDraggingOver && 'bg-white/5'
            )}
          >
            {tasks.map((task, index) => (
              <TaskCard key={task.id} task={task} index={index} onDelete={onDelete} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
