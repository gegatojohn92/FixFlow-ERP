# GitHub Copilot Custom Instructions

## Core Principles
1. Never guess—always inspect full context using `#file` or `@workspace` before writing code.
2. Make minimal, targeted changes. Do not rewrite entire files unless explicitly asked.
3. Preserve existing code style, imports, and comments unless they directly conflict with the new change.
4. Do not leave placeholders, incomplete logic, or comments like `// ... rest of the code`. Always output full, functional edits.

## Rules for Adding Features
1. **Incremental Execution:** Build features in order: 
   - Step 1: Database/Types/Schema updates
   - Step 2: Backend API/Service handlers
   - Step 3: Frontend UI components
2. **Type Safety:** Ensure TypeScript types/interfaces are updated first before implementing component logic.
3. **No Regressive Code:** Check if new features break dependent files or existing function signatures before proposing changes.

## Rules for Fixing Bugs
1. **Root Cause First:** Explain *why* the bug occurs in 1-2 sentences before providing any code fix.
2. **Preserve Edge Cases:** Never delete existing validation, error handling, or edge-case logic to make a fix work.
3. **Trace Dependencies:** If modifying a function signature or return type, list all other files that call this function and update them accordingly.