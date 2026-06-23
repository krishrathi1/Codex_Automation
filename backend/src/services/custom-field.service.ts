import { prisma } from '../lib/prisma.js';
import type { CustomFieldType, CustomFieldVisibility } from '@prisma/client';

export async function listDefinitions(organizationId: string) {
  return prisma.taskCustomFieldDefinition.findMany({
    where: { organizationId },
    orderBy: { label: 'asc' },
    include: { _count: { select: { boardFields: true, values: true } } },
  });
}

export async function createDefinition(organizationId: string, data: {
  fieldKey: string;
  label: string;
  fieldType?: CustomFieldType;
  uiVisibility?: CustomFieldVisibility;
  validationRegex?: string;
  defaultValue?: string;
}) {
  return prisma.taskCustomFieldDefinition.create({
    data: { organizationId, ...data },
    include: { _count: { select: { boardFields: true, values: true } } },
  });
}

export async function updateDefinition(id: string, organizationId: string, data: {
  label?: string;
  fieldType?: CustomFieldType;
  uiVisibility?: CustomFieldVisibility;
  validationRegex?: string | null;
  defaultValue?: string | null;
}) {
  return prisma.taskCustomFieldDefinition.update({
    where: { id, organizationId },
    data,
    include: { _count: { select: { boardFields: true, values: true } } },
  });
}

export async function deleteDefinition(id: string, organizationId: string) {
  return prisma.taskCustomFieldDefinition.delete({ where: { id, organizationId } });
}

export async function attachToBoard(definitionId: string, organizationId: string, boardIds: string[]) {
  // Verify definition belongs to org
  const def = await prisma.taskCustomFieldDefinition.findFirst({ where: { id: definitionId, organizationId } });
  if (!def) throw new Error('Custom field definition not found');

  // Verify boards belong to org
  const boards = await prisma.board.findMany({ where: { id: { in: boardIds }, organizationId } });
  if (boards.length !== boardIds.length) throw new Error('Some boards not found');

  // Upsert attachments
  const results = await Promise.all(
    boardIds.map(boardId =>
      prisma.boardTaskCustomField.upsert({
        where: { boardId_definitionId: { boardId, definitionId } },
        create: { boardId, definitionId },
        update: {},
      })
    )
  );
  return results;
}

export async function getBoardFields(boardId: string, organizationId: string) {
  return prisma.boardTaskCustomField.findMany({
    where: { boardId, board: { organizationId } },
    include: { definition: true },
  });
}

export async function setFieldValue(taskId: string, definitionId: string, value: string, organizationId: string) {
  if (!taskId || !definitionId) {
    const err = new Error('taskId and definitionId are required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  // Both the task and the definition must belong to the caller's org.
  const [task, definition] = await Promise.all([
    prisma.task.findFirst({ where: { id: taskId, organizationId }, select: { id: true } }),
    prisma.taskCustomFieldDefinition.findFirst({ where: { id: definitionId, organizationId }, select: { id: true } }),
  ]);
  if (!task || !definition) {
    const err = new Error('Task or custom field definition not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return prisma.taskCustomFieldValue.upsert({
    where: { taskId_definitionId: { taskId, definitionId } },
    create: { taskId, definitionId, value },
    update: { value },
  });
}

export async function getTaskFieldValues(taskId: string, organizationId: string) {
  return prisma.taskCustomFieldValue.findMany({
    where: { taskId, task: { organizationId } },
    include: { definition: true },
  });
}
