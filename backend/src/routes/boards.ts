import { Router } from 'express';
import * as boardService from '../services/board.service.js';
import * as collaborationService from '../services/board-collaboration.service.js';
import * as blackboardService from '../services/blackboard.service.js';

const router = Router();

// Board Groups
router.get('/groups', async (req, res) => {
  const groups = await boardService.getAllBoardGroups(req.organizationId!);
  res.json(groups);
});

router.post('/groups', async (req, res) => {
  const group = await boardService.createBoardGroup(req.organizationId!, req.body);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('boardGroup:created', group);
  res.status(201).json(group);
});

router.patch('/groups/:id', async (req, res) => {
  const group = await boardService.updateBoardGroup(req.params.id, req.organizationId!, req.body);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('boardGroup:updated', group);
  res.json(group);
});

router.delete('/groups/:id', async (req, res) => {
  await boardService.deleteBoardGroup(req.params.id, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('boardGroup:deleted', { id: req.params.id });
  res.status(204).end();
});

// Boards
router.get('/', async (req, res) => {
  const boards = await boardService.getAllBoards(req.organizationId!);
  res.json(boards);
});

// Board Snapshot — full board state in one response
router.get('/:id/snapshot', async (req, res) => {
  const snapshot = await boardService.getBoardSnapshot(req.params.id, req.organizationId!);
  if (!snapshot) return res.status(404).json({ error: 'Board not found' });
  res.json(snapshot);
});

router.get('/:id/live-blackboard/trace', async (req, res) => {
  try {
    const trace = await blackboardService.getBoardLiveBlackboardTrace(
      req.organizationId!,
      req.params.id,
      typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined,
    );
    res.json(trace);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

// Board Group Snapshot — cross-board summary for the board's group
router.get('/groups/:groupId/snapshot', async (req, res) => {
  const includeDone = req.query.includeDone === 'true';
  const perBoardTaskLimit = parseInt(req.query.perBoardTaskLimit as string) || 5;
  const snapshot = await boardService.getBoardGroupSnapshot(req.params.groupId, req.organizationId!, { includeDone, perBoardTaskLimit });
  if (!snapshot) return res.status(404).json({ error: 'Board group not found' });
  res.json(snapshot);
});

router.get('/:id', async (req, res) => {
  const board = await boardService.getBoardById(req.params.id, req.organizationId!);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
});

router.post('/', async (req, res) => {
  const board = await boardService.createBoard(req.organizationId!, req.body);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('board:created', board);
  res.status(201).json(board);
});

router.patch('/:id', async (req, res) => {
  const board = await boardService.updateBoard(req.params.id, req.organizationId!, req.body);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('board:updated', board);
  res.json(board);
});

router.delete('/:id', async (req, res) => {
  await boardService.deleteBoard(req.params.id, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('board:deleted', { id: req.params.id });
  res.status(204).end();
});

// Board-scoped agent-to-agent starter
router.post('/:id/collaboration/start', async (req, res) => {
  try {
    const result = await collaborationService.startBoardAgentCollaboration(
      req.organizationId!,
      req.params.id,
      req.body,
    );
    const io = req.app.get('io');
    const room = `org:${req.organizationId}`;

    for (const agent of result.agents) {
      io?.to(room).emit('agent:updated', agent);
    }
    for (const task of result.tasks) {
      io?.to(room).emit('task:update', task);
    }
    for (const message of result.messages) {
      io?.to(room).emit('thread:message', { threadId: result.thread.id, message });
    }

    io?.to(room).emit('agent:message', {
      sourceAgent: { id: result.agents[0].id, name: result.agents[0].displayName },
      targetAgent: { id: result.agents[1].id, name: result.agents[1].displayName },
      message: result.messages[0]?.content || result.goal,
      threadId: result.thread.id,
      boardId: result.board.id,
      timestamp: new Date().toISOString(),
    });
    io?.to(room).emit('board:a2aStarted', result);

    res.status(201).json(result);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

router.post('/:id/collaboration/dispatch', async (req, res) => {
  try {
    const result = await collaborationService.dispatchBoardTaskToAgents(
      req.organizationId!,
      req.params.id,
      req.body,
    );
    const io = req.app.get('io');
    const room = `org:${req.organizationId}`;

    for (const agent of result.agents) {
      io?.to(room).emit('agent:updated', agent);
    }
    for (const task of result.tasks) {
      io?.to(room).emit('task:update', task);
    }
    for (const message of result.messages) {
      io?.to(room).emit('thread:message', { threadId: result.thread.id, message });
    }
    for (const runJob of result.runJobs) {
      io?.to(room).emit('agent-run-job:update', runJob);
    }

    io?.to(room).emit('board:taskDispatch', result);
    io?.to(room).emit('agent:message', {
      sourceAgent: { id: result.agents[0].id, name: result.agents[0].displayName },
      targetAgent: { id: 'all', name: 'All agents' },
      message: result.query,
      threadId: result.thread.id,
      boardId: result.board.id,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json(result);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

router.post('/:id/collaboration/live-workflow/start', async (req, res) => {
  try {
    const result = await collaborationService.startLiveAgentWorkflow(
      req.organizationId!,
      req.params.id,
      req.body,
    );
    const io = req.app.get('io');
    const room = `org:${req.organizationId}`;

    for (const agent of result.agents) {
      io?.to(room).emit('agent:updated', agent);
    }
    for (const task of result.tasks) {
      io?.to(room).emit('task:update', task);
    }
    for (const message of result.messages) {
      io?.to(room).emit('thread:message', { threadId: result.thread.id, message });
    }
    for (const runJob of result.runJobs) {
      io?.to(room).emit('agent-run-job:update', runJob);
    }

    io?.to(room).emit('board:liveWorkflowStarted', result);
    io?.to(room).emit('agent:message', {
      sourceAgent: { id: 'admin', name: 'Admin' },
      targetAgent: { id: result.agents[0]?.id, name: result.agents[0]?.displayName },
      message: result.trigger,
      threadId: result.thread.id,
      boardId: result.board.id,
      workflowId: result.workflowId,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json(result);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

router.post('/:id/collaboration/live-blackboard/start', async (req, res) => {
  try {
    const result = await collaborationService.startLiveBlackboardConversation(
      req.organizationId!,
      req.params.id,
      req.body,
    );
    const io = req.app.get('io');
    const room = `org:${req.organizationId}`;

    for (const agent of result.agents) {
      io?.to(room).emit('agent:updated', agent);
    }
    for (const task of result.tasks) {
      io?.to(room).emit('task:update', task);
    }
    for (const message of result.messages) {
      io?.to(room).emit('thread:message', { threadId: result.thread.id, message });
    }
    for (const runJob of result.runJobs) {
      io?.to(room).emit('agent-run-job:update', runJob);
    }

    io?.to(room).emit('board:liveBlackboardStarted', result);
    io?.to(room).emit('agent:message', {
      sourceAgent: { id: 'admin', name: 'Admin' },
      targetAgent: { id: 'live-blackboard', name: 'Live blackboard agents' },
      message: result.trigger,
      threadId: result.thread.id,
      boardId: result.board.id,
      conversationId: result.conversationId,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json(result);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(statusCode).json({ error: (err as Error).message });
  }
});

// Board agent management
router.post('/:id/agents', async (req, res) => {
  try {
    const { agentId, isLead, integrationAccess } = req.body;
    const agent = await boardService.addAgentToBoard(req.params.id, agentId, req.organizationId!, isLead, integrationAccess);
    req.app.get('io')?.to(`org:${req.organizationId}`).emit('board:agentAdded', { boardId: req.params.id, agent });
    res.json(agent);
  } catch (e: any) {
    return res.status(404).json({ error: e.message });
  }
});

router.delete('/:id/agents/:agentId', async (req, res) => {
  await boardService.removeAgentFromBoard(req.params.agentId, req.organizationId!);
  req.app.get('io')?.to(`org:${req.organizationId}`).emit('board:agentRemoved', { boardId: req.params.id, agentId: req.params.agentId });
  res.status(204).end();
});

export default router;
