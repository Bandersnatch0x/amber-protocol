import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/sessions/$id')({
  component: SessionDetailLayout,
});

function SessionDetailLayout() {
  return <Outlet />;
}
