import { prisma } from './src/lib/prisma.js';
// Replicate the FIXED parsePipelineContext unwrap against the real stuck packet.
function objectRecord(v){ return v && typeof v==='object' && !Array.isArray(v) ? v : {}; }
function parse(value){
  let record = objectRecord(value);
  if (record.source !== 'production_error_pipeline' && objectRecord(record.sourceContext).source === 'production_error_pipeline') {
    record = objectRecord(record.sourceContext);
  }
  const role = typeof record.pipelineRole==='string'?record.pipelineRole:undefined;
  return { source: record.source, pipelineRole: ['debug','review','commit'].includes(role)?role:undefined, productionErrorEventId: record.productionErrorEventId };
}
const job = await prisma.agentRunJob.findUnique({ where: { id: 'e5d40577-c764-4262-9a55-f68dd32d854f' }, select: { contextPacket: true, taskId: true } });
const ctx = parse(job.contextPacket);
console.log('RESOLVED CONTEXT:', JSON.stringify(ctx));
console.log('would advance?', ctx.source==='production_error_pipeline' && !!ctx.productionErrorEventId && !!ctx.pipelineRole);
console.log('job.taskId (heal source):', job.taskId);
await prisma.$disconnect();
