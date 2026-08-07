import type { EnvironmentId, VcsStatusResult } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { useMemo, useState } from "react";

import { useMergeChangeRequestAction } from "~/lib/sourceControlActions";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";

type ChangeRequestSummary = NonNullable<VcsStatusResult["pr"]>;

interface MergeChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
  cwd: string;
  reference: string;
  changeRequest: ChangeRequestSummary;
  onMerged: () => void;
}

export function MergeChangeRequestDialog(props: MergeChangeRequestDialogProps) {
  const [squash, setSquash] = useState(false);
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(false);
  const scope = useMemo(
    () => ({ environmentId: props.environmentId, cwd: props.cwd }),
    [props.environmentId, props.cwd],
  );
  const mergeChangeRequest = useMergeChangeRequestAction(scope);

  const handleConfirm = async () => {
    const result = await mergeChangeRequest.run({
      reference: props.reference,
      squash,
      deleteSourceBranch,
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        mergeChangeRequest.resetError();
      }
      return;
    }
    props.onMerged();
    props.onOpenChange(false);
  };

  const errorMessage =
    mergeChangeRequest.error instanceof Error
      ? mergeChangeRequest.error.message
      : mergeChangeRequest.error
        ? "Failed to merge — see server logs for details."
        : null;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (!mergeChangeRequest.isPending) {
          props.onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge #{props.changeRequest.number}</DialogTitle>
          <DialogDescription>
            Merge &ldquo;{props.changeRequest.title}&rdquo; ({props.changeRequest.headRef} →{" "}
            {props.changeRequest.baseRef}) into {props.changeRequest.baseRef}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={squash}
              onCheckedChange={(checked) => setSquash(checked === true)}
              disabled={mergeChangeRequest.isPending}
            />
            Squash commits
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={deleteSourceBranch}
              onCheckedChange={(checked) => setDeleteSourceBranch(checked === true)}
              disabled={mergeChangeRequest.isPending}
            />
            Delete source branch after merge
          </label>
          {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => props.onOpenChange(false)}
            disabled={mergeChangeRequest.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={mergeChangeRequest.isPending}
          >
            {mergeChangeRequest.isPending ? "Merging..." : "Merge"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
