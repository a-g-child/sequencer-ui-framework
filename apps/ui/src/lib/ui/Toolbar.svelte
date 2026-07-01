<div class="ui-toolbar">
  <slot />
</div>

<style>
  .ui-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
</style>
