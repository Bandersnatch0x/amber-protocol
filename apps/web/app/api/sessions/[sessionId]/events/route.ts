import { handleSSE } from '@/server/routes/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ExpressLikeRequest {
  params: { sessionId: string };
  query: Record<string, string>;
}

interface ExpressLikeResponse {
  setHeader: (name: string, value: string) => void;
  write: (data: string) => void;
  flushHeaders: () => void;
  on: (event: string, cb: () => void) => void;
}

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  const req: ExpressLikeRequest = {
    params: { sessionId: params.sessionId },
    query: Object.fromEntries(new URL(request.url).searchParams),
  };

  const res = new Response(
    new ReadableStream({
      start(controller) {
        const mockRes: ExpressLikeResponse = {
          setHeader: () => {},
          write: (data: string) => {
            controller.enqueue(new TextEncoder().encode(data));
          },
          flushHeaders: () => {},
          on: (event: string, cb: () => void) => {
            if (event === 'close') {
              request.signal.addEventListener('abort', cb);
            }
          },
        };

        handleSSE(req, mockRes);

        request.signal.addEventListener('abort', () => {
          controller.close();
        });
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    }
  );

  return res;
}
