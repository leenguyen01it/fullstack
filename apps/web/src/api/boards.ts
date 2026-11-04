import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardColumn,
  BoardDetail,
  BoardSummary,
  CreateTaskInput,
  MoveTaskInput,
  OffsetPage,
  Task,
  UpdateTaskInput,
} from '@taskflow/shared';
import { apiFetch } from './client';

/**
 * Builds the query keys for boards: lists live under their workspace, details under the board id.
 * @since REQ-007
 */
export const boardKeys = {
  list: (workspaceId: string, page: number) => ['workspace', workspaceId, 'boards', page] as const,
  lists: (workspaceId: string) => ['workspace', workspaceId, 'boards'] as const,
  detail: (boardId: string) => ['board', boardId] as const,
};

/**
 * Fetches one page of a workspace's boards, keeping the previous page visible while the next loads.
 * @since REQ-007
 */
export function useBoards(workspaceId: string, page: number, pageSize = 10) {
  return useQuery({
    queryKey: boardKeys.list(workspaceId, page),
    queryFn: () =>
      apiFetch<OffsetPage<BoardSummary>>(
        `/workspaces/${workspaceId}/boards?page=${page}&pageSize=${pageSize}`,
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Fetches a board with its ordered columns and tasks.
 * @since REQ-007
 */
export function useBoard(workspaceId: string, boardId: string) {
  return useQuery({
    queryKey: boardKeys.detail(boardId),
    queryFn: () => apiFetch<BoardDetail>(`/workspaces/${workspaceId}/boards/${boardId}`),
  });
}

/**
 * Provides create, rename and delete mutations for boards and add/delete mutations for columns.
 * @since REQ-007
 */
export function useBoardMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const base = `/workspaces/${workspaceId}/boards`;
  const refreshLists = () =>
    queryClient.invalidateQueries({ queryKey: boardKeys.lists(workspaceId) });
  const refreshBoard = (boardId: string) =>
    queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) });

  return {
    create: useMutation({
      mutationFn: (name: string) =>
        apiFetch<BoardDetail>(base, { method: 'POST', body: JSON.stringify({ name }) }),
      onSuccess: (board) => {
        queryClient.setQueryData(boardKeys.detail(board.id), board);
        return refreshLists();
      },
    }),
    rename: useMutation({
      mutationFn: ({ boardId, name }: { boardId: string; name: string }) =>
        apiFetch<BoardSummary>(`${base}/${boardId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        }),
      onSuccess: (board) => Promise.all([refreshLists(), refreshBoard(board.id)]),
    }),
    remove: useMutation({
      mutationFn: (boardId: string) => apiFetch<void>(`${base}/${boardId}`, { method: 'DELETE' }),
      onSuccess: (_data, boardId) => {
        queryClient.removeQueries({ queryKey: boardKeys.detail(boardId) });
        return refreshLists();
      },
    }),
    addColumn: useMutation({
      mutationFn: ({ boardId, name }: { boardId: string; name: string }) =>
        apiFetch<BoardColumn>(`${base}/${boardId}/columns`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        }),
      onSuccess: (_column, { boardId }) => refreshBoard(boardId),
    }),
    removeColumn: useMutation({
      mutationFn: ({ boardId, columnId }: { boardId: string; columnId: string }) =>
        apiFetch<void>(`${base}/${boardId}/columns/${columnId}`, { method: 'DELETE' }),
      onSuccess: (_data, { boardId }) => refreshBoard(boardId),
    }),
  };
}

/**
 * Provides create, update and delete mutations for the tasks of a board, refreshing the board and
 * the workspace's task searches afterwards.
 * @since REQ-007
 */
export function useTaskMutations(workspaceId: string, boardId: string) {
  const queryClient = useQueryClient();
  const base = `/workspaces/${workspaceId}/tasks`;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) }),
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'tasks'] }),
    ]);

  return {
    create: useMutation({
      mutationFn: (input: CreateTaskInput) =>
        apiFetch<Task>(base, { method: 'POST', body: JSON.stringify(input) }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ taskId, ...input }: UpdateTaskInput & { taskId: string }) =>
        apiFetch<Task>(`${base}/${taskId}`, { method: 'PATCH', body: JSON.stringify(input) }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (taskId: string) => apiFetch<void>(`${base}/${taskId}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

/**
 * Moves a task optimistically: reorders the cached board at once, rolls back on error and
 * re-syncs with the server once no move is still in flight.
 * @since REQ-007
 */
export function useMoveTask(workspaceId: string, boardId: string) {
  const queryClient = useQueryClient();
  const key = boardKeys.detail(boardId);

  return useMutation({
    mutationKey: ['move-task', boardId],
    mutationFn: ({ taskId, ...input }: MoveTaskInput & { taskId: string }) =>
      apiFetch<Task>(`/workspaces/${workspaceId}/tasks/${taskId}/move`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onMutate: async (move) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<BoardDetail>(key);
      if (snapshot) queryClient.setQueryData(key, applyMove(snapshot, move));
      return { snapshot };
    },
    onError: (_error, _move, context) => {
      if (context?.snapshot) queryClient.setQueryData(key, context.snapshot);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ['move-task', boardId] }) <= 1) {
        return queryClient.invalidateQueries({ queryKey: key });
      }
      return undefined;
    },
  });
}

/**
 * Returns a copy of the board with the task moved into the target column right after afterTaskId
 * (or at the top when it is null).
 * @since REQ-007
 */
export function applyMove(
  board: BoardDetail,
  { taskId, columnId, afterTaskId }: MoveTaskInput & { taskId: string },
): BoardDetail {
  const task = board.columns.flatMap((column) => column.tasks).find((t) => t.id === taskId);
  if (!task) return board;
  const moved = { ...task, columnId };
  return {
    ...board,
    columns: board.columns.map((column) => {
      const tasks = column.tasks.filter((t) => t.id !== taskId);
      if (column.id !== columnId)
        return tasks.length === column.tasks.length ? column : { ...column, tasks };
      const index = afterTaskId === null ? 0 : tasks.findIndex((t) => t.id === afterTaskId) + 1;
      tasks.splice(index, 0, moved);
      return { ...column, tasks };
    }),
  };
}
