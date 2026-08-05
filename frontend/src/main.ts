import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router/index.ts";
import { useStatusStore } from "./stores/status.ts";
import "./styles/main.css";
import App from "./App.vue";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

// start SSE connection after Pinia is ready
useStatusStore().init();
