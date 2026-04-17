const API_BASE = `${window.location.protocol}//${window.location.host}/api`

interface RouteInfo {
  method: string
  path: string
}

const COMMAND_MAP: Record<string, (args?: Record<string, unknown>) => RouteInfo> = {
  get_tools: () => ({ method: 'GET', path: '/tools' }),
  save_tool: () => ({ method: 'POST', path: '/tools' }),
  delete_tool: (args) => ({ method: 'DELETE', path: `/tools/${args?.id}` }),
  get_materials: () => ({ method: 'GET', path: '/materials' }),
  save_material: () => ({ method: 'POST', path: '/materials' }),
  delete_material: (args) => ({ method: 'DELETE', path: `/materials/${args?.id}` }),
  authenticate: () => ({ method: 'POST', path: '/auth' }),
  save_project: () => ({ method: 'POST', path: '/projects/save' }),
  load_project: () => ({ method: 'POST', path: '/projects/load' }),
  process_image_for_laser: () => ({ method: 'POST', path: '/image/process' }),
  process_image_base64_for_laser: () => ({ method: 'POST', path: '/image/process' }),
  read_raster_pixels: (args) => ({
    method: 'GET',
    path: `/image/pixels?path=${encodeURIComponent(String(args?.pixelsPath ?? ''))}`,
  }),
  // Jobs
  get_jobs: () => ({ method: 'GET', path: '/jobs' }),
  create_job: () => ({ method: 'POST', path: '/jobs' }),
  delete_job: (args) => ({ method: 'DELETE', path: `/jobs/${args?.id}` }),
  approve_job: (args) => ({ method: 'POST', path: `/jobs/${args?.id}/approve` }),
  cancel_job: (args) => ({ method: 'POST', path: `/jobs/${args?.id}/cancel` }),
  // Serial
  serial_list_ports: () => ({ method: 'GET', path: '/serial/ports' }),
  serial_connect: () => ({ method: 'POST', path: '/serial/connect' }),
  serial_disconnect: () => ({ method: 'POST', path: '/serial/disconnect' }),
  serial_send: () => ({ method: 'POST', path: '/serial/send' }),
  serial_send_gcode: () => ({ method: 'POST', path: '/serial/gcode' }),
  serial_cancel_send: () => ({ method: 'POST', path: '/serial/cancel' }),
}

export async function httpInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const routeFn = COMMAND_MAP[cmd]
  if (!routeFn) {
    throw new Error(`Comando no mapeado para HTTP: ${cmd}`)
  }

  const { method, path } = routeFn(args)
  const url = `${API_BASE}${path}`

  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }

  if (method !== 'GET' && method !== 'DELETE' && args) {
    options.body = JSON.stringify(args)
  }

  const response = await fetch(url, options)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || `HTTP ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}
