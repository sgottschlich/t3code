import type { ProjectScript } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { DetectedProjectScript } from "~/hooks/usePackageManagerScripts";
import {
  groupImportableDetectedScripts,
  guessDetectedScriptIcon,
} from "./projectScriptCommandPicker.logic";
import { ScriptIcon } from "./projectScriptEditor";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

function DetectedScriptGroup(props: {
  label: string;
  scripts: ReadonlyArray<DetectedProjectScript>;
  onPick: (script: DetectedProjectScript) => void;
}) {
  if (props.scripts.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2 py-1 text-xs font-medium text-muted-foreground">{props.label}</span>
      {props.scripts.map((script) => (
        <button
          key={`${script.source}:${script.name}`}
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => props.onPick(script)}
        >
          <ScriptIcon icon={guessDetectedScriptIcon(script.name)} className="size-3.5" />
          <span className="truncate">{script.name}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Inserts a script detected in `package.json` / `composer.json` into the
 * action editor's Command field. Renders nothing when every detected script
 * is already an action, so the Command label keeps its plain layout.
 */
export function ProjectScriptCommandPicker(props: {
  detected: ReadonlyArray<DetectedProjectScript>;
  scripts: ReadonlyArray<Pick<ProjectScript, "name" | "command">>;
  onPick: (script: DetectedProjectScript) => void;
}) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(
    () => groupImportableDetectedScripts({ detected: props.detected, scripts: props.scripts }),
    [props.detected, props.scripts],
  );
  if (!grouped.hasAny) return null;

  const pick = (script: DetectedProjectScript) => {
    props.onPick(script);
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Insert detected script" />
        }
      >
        <PlusIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup align="end">
        <div className="flex w-56 flex-col gap-1">
          <DetectedScriptGroup label="package.json" scripts={grouped.npm} onPick={pick} />
          <DetectedScriptGroup label="composer.json" scripts={grouped.composer} onPick={pick} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
