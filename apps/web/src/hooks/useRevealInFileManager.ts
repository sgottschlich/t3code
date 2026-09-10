import type { EnvironmentId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Cause from "effect/Cause";
import { useCallback } from "react";

import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "~/components/preview/fileExplorerLabel";
import { PreferredEditorEnvironmentRequiredError } from "~/editorPreferences";
import { serverEnvironment } from "~/state/server";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * Reveals a path in the host's file manager. `label` is undefined when the
 * environment cannot do it (old server, no file-manager editor), which is the
 * signal to leave the menu entry out rather than show a dead one.
 */
export function useRevealInFileManager(environmentId: EnvironmentId | null): {
  readonly label: string | undefined;
  readonly reveal: (path: string) => Promise<AtomCommandResult<unknown, unknown>>;
} {
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });

  const label =
    environmentId !== null &&
    serverConfig?.shellRevealInFileManager === true &&
    serverConfig.availableEditors.includes("file-manager")
      ? serverConfig.shellRevealInFileManagerKind === undefined
        ? revealInFileExplorerLabelForOs(serverConfig.environment.platform.os)
        : revealInFileExplorerLabelForKind(serverConfig.shellRevealInFileManagerKind)
      : undefined;

  const reveal = useCallback(
    (path: string) => {
      if (environmentId === null) {
        return Promise.resolve(
          AsyncResult.failure<void, PreferredEditorEnvironmentRequiredError>(
            Cause.fail(new PreferredEditorEnvironmentRequiredError({ targetPath: path })),
          ),
        );
      }
      return openInEditor({
        environmentId,
        input: { cwd: path, editor: "file-manager", reveal: true },
      });
    },
    [environmentId, openInEditor],
  );

  return { label, reveal };
}
