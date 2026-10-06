import { createApp } from 'vue'
import { createPinia } from 'pinia'

import { ensureSettlementReady } from './api/settlement-service'
import App from './App.vue'
import router from './router'
import './styles/global.css'

// 启动即完成存量沉降成果归一化与检修联动，任何入口读到的口径都一致。
ensureSettlementReady()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
