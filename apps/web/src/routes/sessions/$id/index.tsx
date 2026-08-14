import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const sessionSearchSchema = z.object({
  from: z.string().optional(),
});

export const Route = createFileRoute('/sessions/$id/')({
  validateSearch: (search) => sessionSearchSchema.parse(search),
});
