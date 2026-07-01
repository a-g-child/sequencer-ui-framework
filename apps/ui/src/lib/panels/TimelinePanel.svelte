<script lang="ts">
  import type { TimelineView } from '../timeline/timeline-model';

  export let timeline: TimelineView;
</script>

<section class="timeline-panel" aria-label="Timeline">
  <div class="pane-heading">
    <h2>Timeline</h2>
    <span>{timeline.length} beats</span>
  </div>
</section>

<style>
  .timeline-panel {
    display: grid;
    gap: var(--spacing-compact);
  }
</style>
