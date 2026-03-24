import type { RouterScrollBehavior } from 'vue-router';

export const appScrollBehavior: RouterScrollBehavior = (_to, _from, savedPosition) => {
  if (savedPosition) {
    return savedPosition;
  }

  return {
    top: 0,
    left: 0,
  };
};
