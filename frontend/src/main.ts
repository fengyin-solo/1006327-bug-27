import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { ensureSettlementReady } from './settlement/service'

// 启动即完成存量沉降成果回填与检修待办同步，保证任一入口读到的口径一致。
ensureSettlementReady()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
