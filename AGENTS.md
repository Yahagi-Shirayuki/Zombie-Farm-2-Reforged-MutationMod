# Repository Agent Instructions

These instructions apply to the entire repository.

## Actions Requiring Explicit Permission

- Do not push code or branches to any remote without the user's explicit permission.
- Do not deploy the server or worker to any environment without the user's explicit permission.
- Do not apply database migrations to any local or remote database without the user's explicit permission.
- A request to implement, fix, test, or complete a task does not by itself grant permission for any of the actions above. Obtain permission for the specific push, deployment, or migration before performing it.

## Completion Report

After completing every task, explicitly report:

- Whether the worker needs to be deployed for the completed changes to take effect.
- Whether a database migration needs to be applied for the completed changes to take effect.

State `Yes`, `No`, or `Unknown` for each item and briefly explain any required next action. Reporting that an action is needed does not authorize performing it.
