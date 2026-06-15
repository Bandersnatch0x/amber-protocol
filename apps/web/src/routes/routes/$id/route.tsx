import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/routes/$id')({
  component: RouteDetailLayout,
});

function RouteDetailLayout() {
  return <Outlet />;
}
