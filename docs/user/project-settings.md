# Project settings

Open **Settings → Projects**. The project and machine pickers start at **All projects** and
**All machines**.

Change the default model, workspace, automatic pull, agent browser access, or actions for projects that inherit those values.
Select an individual project to override a default. Reset its row to inherit again. Changing a
default preserves explicit project overrides. Workspace preferences in `t3.json` take precedence
over machine defaults when the project has no explicit workspace override.

Select a machine to limit edits to it. **All machines** writes defaults to connected machines;
offline machines keep their previous values. Mixed values are indicated when selected machines
or checkouts disagree. Browser access changes apply when an agent session next starts.

Project grouping has a client-wide default across machines, with individual checkout overrides.
Shared actions apply to inheriting projects; editing a project's actions creates an independent list.
Reset that list to use shared actions again. Existing project actions are preserved.

Project names, icons, removal, and importing actions from a checkout remain project-specific.
When there are several checkouts, the checkout picker selects which actions and grouping to edit.

## Project routines

In the web or desktop client, open **Settings → General → Routines & worktree cleanup** and
choose a project in the selected environment. Create a routine with a prompt, provider/model,
first start time and optional repeat interval. Each run creates a normal thread in that project's
current checkout. Results and approval requests appear in that thread; **Open last run** takes you there.

The environment's server must be running, but clients may be closed. Overdue starts are combined
into one run after restart, and the same routine never overlaps its previous active run. Intervals
are elapsed minutes, not calendar schedules, so their local time can shift across daylight-saving changes.
Pause or delete a routine to stop future starts; this does not stop or delete its existing threads.
**Run now** also works while paused. Approval-required runs wait for your response; choose full
access only when you want the selected provider to work unattended.

Routine management is available in web and desktop. Run threads can be opened on mobile.

## Project icons

Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to selected checkouts in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
