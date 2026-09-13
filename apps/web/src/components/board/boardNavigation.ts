import type { useRouter } from "@tanstack/react-router";

export const BOARD_ROUTE_PATH = "/board";

/**
 * `board.toggle`: open the board, or leave it the way the sidebar's Back
 * button does when it is already open, so one key both opens and dismisses.
 */
export function toggleBoardRoute(router: ReturnType<typeof useRouter>): void {
  if (router.state.location.pathname === BOARD_ROUTE_PATH) {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }
    void router.navigate({ to: "/" });
    return;
  }
  void router.navigate({ to: BOARD_ROUTE_PATH, search: {} });
}
