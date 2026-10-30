<script lang="ts">
  // Placeholder tap screen; L15 replaces its content. A glyph only: player-facing words belong in locale tables
  // (principle 8). The `lang="ts"` block is what lets `main.ts` import this component with `allowJs` off.
</script>

<main>
  <span aria-hidden="true">▶</span>
</main>

<style>
  main {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    background: #000;
    color: #fff;
    user-select: none;
  }

  span {
    font-size: 48px;
    line-height: 1;
    opacity: 0.85;
  }
</style>
