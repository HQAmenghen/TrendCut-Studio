/**
 * 素材驱动工作流的共享状态
 * 供 materialDriven 路由 和 autoStart 服务共用
 */

const activeTasks = new Map();
const taskClients = new Map();

module.exports = { activeTasks, taskClients };
