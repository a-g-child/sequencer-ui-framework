<script lang="ts">
  export let active = false;
  export let danger = false;
  export let title = '';
  export let disabled = false;
</script>

<button
  type="button"
  class:active
  class:danger
  {title}
  {disabled}
  on:click
>
  <slot />
</button>

<style>
  button {
    min-height: var(--control-height-md);
    padding: var(--spacing-xs) var(--spacing-sm);
    border: var(--border-width) solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-primary);
    cursor: pointer;
    font-weight: 700;
  }

  button:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
  }

  button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  button.danger {
    border-color: var(--danger);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
