import { defineComponent, h } from 'vue'

export default defineComponent({
  name: 'PrimeToastShim',
  setup() {
    return () => h('div', { style: 'display:none' })
  }
})
