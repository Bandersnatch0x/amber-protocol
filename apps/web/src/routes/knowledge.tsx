import { createFileRoute } from '@tanstack/react-router';
import { KnowledgeMapPage } from '@/features/knowledge/KnowledgeMapPage';

export const Route = createFileRoute('/knowledge')({
  component: KnowledgeMapPage,
});
