// api/gh-EYE.js
module.exports = async (req, res) => {
  // 设置CORS头部（与vercel.json保持一致，避免冲突）
  res.setHeader('Access-Control-Allow-Origin', 'https://enqiliu66.github.io, http://localhost:5500, http://localhost:3000');
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
    const errorMsg = `缺少环境变量: ${missingVars.join(', ')}`;
    console.error('服务器配置错误:', errorMsg);
    return res.status(500).json({
      error: '服务器配置不完整',
      message: errorMsg,
      code: 'MISSING_ENV_VARS'
    });
  }

  try {
    const { action } = req.body;
    if (!action) {
      return res.status(400).json({
        error: '缺少参数',
        message: '必须指定action参数（create_issue/add_comment/upload_file）'
      });
    }

    let Octokit;
    // 动态导入 @octokit/rest 模块
    try {
      const octokitModule = await import('@octokit/rest');
      Octokit = octokitModule.Octokit;
    } catch (importError) {
      const errorMsg = `无法加载Octokit模块: ${importError.message}`;
      console.error('模块导入失败:', errorMsg);
      return res.status(500).json({
        error: '服务器模块加载失败',
        message: errorMsg,
        code: 'MODULE_IMPORT_FAILED'
      });
    }

    const octokit = new Octokit({ 
      auth: process.env.GITHUB_TOKEN,
      // 增加请求超时设置
      request: { timeout: 10000 }
    });

    switch (action) {
      case 'create_issue': {
        const { subjectId, gender, age } = req.body;
        if (!subjectId) {
          return res.status(400).json({
            error: '缺少参数',
            message: '被试ID (subjectId)为必填项'
          });
        }

        try {
          // 搜索现有issue
          const searchResult = await octokit.search.issuesAndPullRequests({
            q: `repo:${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME} in:title ${subjectId} type:issue`
          });
          const { items } = searchResult.data;

          if (items.length > 0) {
            return res.json({ ...items[0], message: 'Issue已存在', code: 'ISSUE_EXISTS' });
          }

          // 创建新issue
          const newIssue = await octokit.issues.create({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            title: subjectId,
            body: `被试信息:\n- 性别: ${gender || '未知'}\n- 年龄: ${age || '未知'}\n- 实验开始时间: ${new Date().toISOString()}`
          });

          return res.json({ ...newIssue.data, message: 'Issue创建成功', code: 'ISSUE_CREATED' });
        } catch (githubError) {
          const errorMsg = `GitHub API错误: ${githubError.message || '未知错误'}`;
          console.error('创建Issue失败:', errorMsg, githubError.status);
          return res.status(500).json({
            error: 'GitHub API调用失败',
            message: errorMsg,
            status: githubError.status,
            code: 'GITHUB_API_ERROR'
          });
        }
      }

      case 'add_comment': {
        const { issueNumber, commentBody } = req.body;
        if (!issueNumber || !commentBody) {
          return res.status(400).json({
            error: '缺少参数',
            message: 'Issue编号和评论内容均为必填项'
          });
        }

        try {
          const comment = await octokit.issues.createComment({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            issue_number: issueNumber,
            body: commentBody
          });
          return res.json({ ...comment.data, message: '评论添加成功', code: 'COMMENT_ADDED' });
        } catch (githubError) {
          const errorMsg = `GitHub API错误: ${githubError.message || '未知错误'}`;
          console.error('添加评论失败:', errorMsg, githubError.status);
          return res.status(500).json({
            error: 'GitHub API调用失败',
            message: errorMsg,
            status: githubError.status,
            code: 'GITHUB_API_ERROR'
          });
        }
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
          const existingFile = await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: fullPath
          });

          // 文件存在，更新文件
          const updatedFile = await octokit.repos.createOrUpdateFileContents({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: fullPath,
            message: `更新数据文件: ${fileName}`,
            content: Buffer.from(content).toString('base64'),
            sha: existingFile.data.sha
          });

          return res.json({
            ...updatedFile.data,
            message: '文件已更新',
            code: 'FILE_UPDATED'
          });
        } catch (error) {
          // 文件不存在，创建新文件
          if (error.status === 404) {
            try {
              const createdFile = await octokit.repos.createOrUpdateFileContents({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: fullPath,
                message: `创建数据文件: ${fileName}`,
                content: Buffer.from(content).toString('base64')
              });

              return res.json({
                ...createdFile.data,
                message: '文件已创建',
                code: 'FILE_CREATED'
              });
            } catch (createError) {
              const errorMsg = `创建文件失败: ${createError.message}`;
              console.error(errorMsg, createError.status);
              return res.status(500).json({
                error: '文件操作失败',
                message: errorMsg,
                status: createError.status,
                code: 'FILE_CREATE_ERROR'
              });
            }
          } else {
            // 其他错误
            const errorMsg = `文件操作异常: ${error.message}`;
            console.error(errorMsg, error.status);
            return res.status(500).json({
              error: '文件操作失败',
              message: errorMsg,
              status: error.status,
              code: 'FILE_OPERATION_ERROR'
            });
          }
        }
      }

      default:
        return res.status(400).json({
          error: '无效的操作',
          message: `不支持的action: ${action}`,
          code: 'INVALID_ACTION'
        });
    }
  } catch (serverError) {
    const errorMsg = `服务器内部错误: ${serverError.message || '未知错误'}`;
    console.error('服务器处理失败:', errorMsg, serverError.stack);
    return res.status(500).json({
      error: '服务器处理失败',
      message: errorMsg,
      code: 'SERVER_INTERNAL_ERROR'
    });
  }
};
