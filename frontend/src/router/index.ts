import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/browse" },
    { path: "/browse", component: () => import("../views/BrowseView.vue") },
    { path: "/queue", component: () => import("../views/QueueView.vue") },
    { path: "/history", component: () => import("../views/HistoryView.vue") },
    { path: "/system", component: () => import("../views/SystemView.vue") },
  ],
});

export default router;
