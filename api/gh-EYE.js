// api/gh-EYE.js
module.exports = async (req, res) => {
  // 设置CORS头部
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

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

        // 搜索现有issue
        const { data: { items } } = await octokit.search.issuesAndPullRequests({
          q: `repo:${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME} in:title ${subjectId} type:issue`
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
          await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: fullPath
          });

          // 文件存在，更新文件
          const { data: existingFile } = await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: fullPath
          });

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

    // 提供更详细的错误信息
    let errorMessage = error.message || error.toString();
    if (error.response) {
      errorMessage += ` | GitHub API响应: ${JSON.stringify(error.response.data)}`;
    }

    return res.status(500).json({
      error: '服务器处理失败',
      message: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};