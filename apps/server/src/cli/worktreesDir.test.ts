import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as NetService from "@t3tools/shared/Net";
import { resolveServerConfig } from "./config.ts";

it.effect("uses CLI over environment over default without relocating application state", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "worktree-dir-test-" });
    const flags = {
      mode: Option.none(),
      port: Option.some(4444),
      host: Option.none(),
      baseDir: Option.some(root),
      cwd: Option.some(root),
      devUrl: Option.none(),
      noBrowser: Option.none(),
      bootstrapFd: Option.none(),
      autoBootstrapProjectFromCwd: Option.none(),
      logWebSocketEvents: Option.none(),
      tailscaleServeEnabled: Option.none(),
      tailscaleServePort: Option.none(),
    };
    const resolve = (worktreesDir: string | undefined, env: Record<string, string>) =>
      resolveServerConfig(
        { ...flags, worktreesDir: Option.fromUndefinedOr(worktreesDir) },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(ConfigProvider.layer(ConfigProvider.fromEnv({ env })), NetService.layer),
        ),
      );
    const defaultConfig = yield* resolve(undefined, {});
    expect(defaultConfig.worktreesDir).toBe(path.join(root, "worktrees"));
    const envDir = path.join(root, "environment-worktrees");
    expect((yield* resolve(undefined, { T3CODE_WORKTREES_DIR: envDir })).worktreesDir).toBe(envDir);
    const cliDir = path.join(root, "cli-worktrees");
    const configured = yield* resolve(cliDir, { T3CODE_WORKTREES_DIR: envDir });
    expect(configured.worktreesDir).toBe(cliDir);
    expect(configured.dbPath).toBe(defaultConfig.dbPath);
    expect(configured.settingsPath).toBe(defaultConfig.settingsPath);
    expect(yield* fs.exists(cliDir)).toBe(true);
    expect((yield* resolve("relative/path", {}).pipe(Effect.result))._tag).toBe("Failure");
    expect((yield* resolve("", {}).pipe(Effect.result))._tag).toBe("Failure");
  }).pipe(Effect.provide(NodeServices.layer)),
);
