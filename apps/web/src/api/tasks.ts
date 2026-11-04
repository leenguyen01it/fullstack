import { useInfiniteQuery } from '@tanstack/react-query';
import type { CursorPage, Task } from '@taskflow/shared';
import { apiFetch } from './client';

/**
 * Describes the filters of a task search.
 * @since REQ-007
 */
export interface TaskSearchFilters {
  q: string;
  assigneeId?: string;
}

/**
 * Searches a workspace's tasks page by page with the API's cursor, newest first.
 * @since REQ-007
 */
export function useTaskSearch(workspaceId: string, filters: TaskSearchFilters, pageSize = 20) {
  return useInfiniteQuery({
    queryKey: ['workspace', workspaceId, 'tasks', filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (filters.q) params.set('q', filters.q);
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<CursorPage<Task>>(`/workspaces/${workspaceId}/tasks?${params}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
