module.exports = async (req, res) => {
  // 设置CORS头部
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 验证环境变量
  const requiredEnvVars = ['GITHUB_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    return res.status(500).json({
      error: '服务器配置不完整',
      message: `缺少环境变量: ${missingVars.join(', ')}`
    });
  }

  try {
    const { action } = req.body;
    let Octokit;
    
    // 动态导入 @octokit/rest 模块
    try {
      const octokitModule = await import('@octokit/rest');
      Octokit = octokitModule.Octokit;
    } catch (importError) {
      console.error('模块导入失败:', importError);
      return res.status(500).json({
        error: '服务器模块加载失败',
        message: `无法加载Octokit模块: ${importError.message}`
      });
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    switch (action) {
      case 'create_issue': {
        const { subjectId, gender, age } = req.body;
        if (!subjectId) {
          return res.status(400).json({ 
            error: '缺少参数', 
            message: '被试ID (subjectId)为必填项' 
          });
        }

        // 修复仓库名截断问题
        const repoFullName = `${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}`;
        
        // 搜索现有issue
        const { data: { items } } = await octokit.search.issuesAndPullRequests({
          q: `repo:${repoFullName} in:title ${subjectId} type:issue`
        });

        if (items.length > 0) {
          return res.json({ ...items[0], message: 'Issue已存在' });
        }

        // 创建新issue
        const { data: newIssue } = await octokit.issues.create({
          owner: process.env.GITHUB_REPO_OWNER,
          repo: process.env.GITHUB_REPO_NAME,
          title: subjectId,
          body: `被试信息:\n- 性别: ${gender || '未知'}\n- 年龄: ${age || '未知'}\n- 实验开始时间: ${new Date().toISOString()}`
        });

        return res.json(newIssue);
      }

      case 'add_comment': {
        const { issueNumber, commentBody } = req.body;
        if (!issueNumber || !commentBody) {
          return res.status(400).json({
            error: '缺少参数',
            message: 'Issue编号和评论内容均为必填项'
          });
        }

        const { data: comment } = await octokit.issues.createComment({
          owner: process.env.GITHUB_REPO_OWNER,
          repo: process.env.GITHUB_REPO_NAME,
          issue_number: issueNumber,
          body: commentBody
        });

        return res.json(comment);
      }

      // 修复action名称不一致问题
      case 'upload_file': {
        const { fileName, content } = req.body;
        if (!fileName || !content) {
          return res.status(400).json({
            error: '缺少参数',
            message: '文件名和内容均为必填项'
          });
        }

        const { data: file } = await octokit.repos.createOrUpdateFileContents({
          owner: process.env.GITHUB_REPO_OWNER,
          repo: process.env.GITHUB_REPO_NAME,
          path: fileName,
          message: `添加数据文件: ${fileName}`,
          content: Buffer.from(content).toString('base64')
        });

        return res.json(file);
      }

      default:
        return res.status(400).json({
          error: '未知操作',
          message: `不支持的操作类型: ${action}`,
          availableActions: ['create_issue', 'add_comment', 'upload_file']
        });
    }
  } catch (error) {
    console.error('API错误:', error);
    return res.status(500).json({
      error: '服务器处理失败',
      message: error.message || error.toString()
    });
  }
};
