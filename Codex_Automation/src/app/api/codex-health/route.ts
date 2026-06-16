import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('http://localhost:3003/health', {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    return NextResponse.json({ ...data, serviceRunning: true });
  } catch {
    return NextResponse.json({ 
      status: 'offline',
      serviceRunning: false,
      message: 'Codex service is not running'
    });
  }
}
