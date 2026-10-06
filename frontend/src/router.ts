import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import RoomPage from './pages/RoomPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/live/:code', name: 'live', component: RoomPage, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
