import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './app.js'

const port = Number(process.env.PORT ?? 3010)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hexon backend listening on http://127.0.0.1:${info.port}`)
  console.log(`Scalar docs available at http://127.0.0.1:${info.port}/docs`)
})
