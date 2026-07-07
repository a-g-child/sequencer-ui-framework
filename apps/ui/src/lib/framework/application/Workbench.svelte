<script lang="ts">
  export let workspaceMode: 'split' | 'full' = 'split'
</script>

<main class="workbench">
  <header class="workbench-top">
    <slot name="top" />
  </header>

  <section
    class="workbench-workspace"
    class:full={workspaceMode === 'full'}
    aria-label="Workspace"
  >
    <aside class="workbench-left">
      <slot name="left" />
    </aside>

    <section class="workbench-center">
      <slot name="center" />
    </section>
  </section>

  <section class="workbench-bottom">
    <slot name="bottom" />
  </section>
</main>

<style>
  .workbench {
    width: min(var(--shell-max-width), 100%);
    min-height: 100vh;
    margin: 0 auto;
    padding: var(--spacing-lg);
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: var(--spacing-lg);
  }

  .workbench-top,
  .workbench-workspace {
    border: var(--border-width) solid var(--border);
    background: var(--surface);
    box-shadow: var(--elevation-raised);
  }

  .workbench-top {
    min-height: var(--topbar-min-height);
    padding: var(--spacing-xl) var(--spacing-2xl);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-lg);
  }

  .workbench-workspace {
    min-height: var(--workspace-min-height);
    display: grid;
    grid-template-columns: minmax(var(--sidebar-min-width), 1fr) minmax(0, 3fr);
  }

  .workbench-workspace.full {
    grid-template-columns: minmax(0, 1fr);
  }

  .workbench-workspace.full .workbench-left {
    display: none;
  }

  .workbench-left,
  .workbench-center {
    min-width: 0;
    padding: var(--spacing-lg);
  }

  .workbench-left {
    border-right: var(--border-width) solid var(--border);
    background: var(--surface-2);
  }

  .workbench-center {
    display: grid;
    align-content: start;
    gap: var(--spacing-xl);
  }

  .workbench-bottom {
    display: grid;
    gap: var(--spacing-lg);
  }

  @media (max-width: 760px) {
    .workbench {
      padding: var(--spacing-md);
    }

    .workbench-top {
      align-items: stretch;
      flex-direction: column;
    }

    .workbench-workspace {
      grid-template-columns: 1fr;
    }

    .workbench-left {
      border-right: 0;
      border-bottom: var(--border-width) solid var(--border);
    }
  }
</style>
