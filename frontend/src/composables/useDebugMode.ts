import { computed, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';

/** Painel de debug é ativado com ?debug=1 na URL. */
export function useDebugMode(): ComputedRef<boolean> {
  const route = useRoute();
  return computed(() => route.query['debug'] === '1');
}
