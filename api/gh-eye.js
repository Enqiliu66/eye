// api/gh-eye.js
const { Octokit } = require('@octokit/rest');

module.exports = async (req, res) => {
  // 设置CORS头部 - 增强版
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  
  // 特殊处理OPTIONS预检请求
  if (req.method === 'OPTIONS') {
    res.setHeader('Content-Length', '0');
    return res.status(204).end();
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

        // 搜索现有issue
        const { data: searchResults } = await octokit.search.issuesAndPullRequests({
          q: `repo:${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME} in:title ${subjectId} type:issue`
        });

        if (searchResults.items.length > 0) {
          return res.json({ ...searchResults.items[0], message: 'Issue已存在' });
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

      case 'upload_file': {
        const { fileName, content, directory } = req.body;
        if (!fileName || !content || !directory) {
          return res.status(400).json({
            error: '缺少参数',
            message: '文件名、内容和目录均为必填项'
          });
        }

        // 构建完整文件路径
        const fullPath = `${directory}/${fileName}`;

        try {
          // 尝试获取文件以检查是否存在
          const { data: existingFile } = await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: fullPath
          });

          // 文件存在，更新文件
          const { data: updatedFile } = await octokit.repos.createOrUpdateFileContents({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: fullPath,
            message: `更新数据文件: ${fileName}`,
            content: Buffer.from(content).toString('base64'),
            sha: existingFile.sha
          });

          return res.json({
            ...updatedFile,
            message: '文件已更新'
          });
        } catch (error) {
          if (error.status === 404) {
            // 文件不存在，创建新文件
            const { data: newFile } = await octokit.repos.createOrUpdateFileContents({
              owner: process.env.GITHUB_REPO_OWNER,
              repo: process.env.GITHUB_REPO_NAME,
              path: fullPath,
              message: `添加数据文件: ${fileName}`,
              content: Buffer.from(content).toString('base64')
            });

            return res.json({
              ...newFile,
              message: '文件已创建'
            });
          }

          // 其他错误
          throw error;
        }
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

    // 友好的错误消息
    let errorMessage = 'GitHub API处理失败';
    if (error.response) {
      errorMessage += ` | 状态码: ${error.response.status}`;
      if (error.response.data && error.response.data.message) {
        errorMessage += ` | 消息: ${error.response.data.message}`;
      }
    } else {
      errorMessage += ` | 详情: ${error.message}`;
    }

    return res.status(500).json({
      error: '服务器处理失败',
      message: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
