import { useEffect, useState } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { Header } from '../components/layout/Header';
import { Column } from '../components/kanban/Column';
import { AddTaskModal } from '../components/kanban/AddTaskModal';
import { useTaskStore } from '../stores/task-store';
import type { TaskStatus } from '../types';

const columns: TaskStatus[] = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE'];

export function KanbanBoard() {
  const { tasks, loading, fetchTasks, moveTask, addTask, deleteTask } = useTaskStore();
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as TaskStatus;
    if (newStatus === result.source.droppableId) return;
    moveTask(result.draggableId, newStatus);
  };

  const tasksByStatus = (status: TaskStatus) => tasks.filter((t) => t.status === status);

  return (
    <div>
      <Header title="Task Board" subtitle="Manage and track agent assignments" />

      {/* Add task button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-nexus-600 hover:bg-nexus-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span className="text-lg leading-none">+</span>
          New Task
        </button>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="text-gray-500 text-sm">Loading tasks...</div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-5 gap-4">
            {columns.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={tasksByStatus(status)}
                onDelete={deleteTask}
              />
            ))}
          </div>
        </DragDropContext>
      )}

      {/* Modal */}
      {showModal && (
        <AddTaskModal
          onClose={() => setShowModal(false)}
          onSubmit={addTask}
        />
      )}
    </div>
  );
}
