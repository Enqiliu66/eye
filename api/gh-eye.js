const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');

// 初始化Octokit客户端
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'Eye Tracking Data Proxy',
  baseUrl: 'https://api.github.com',
});

// 获取环境变量配置
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// 处理CORS预检请求
function handleOptions(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end();
}

// 创建或获取Issue
async function handleCreateIssue(body) {
  const { subjectId, gender, age } = body;
  
  if (!subjectId) {
    throw new Error('缺少被试ID(subjectId)');
  }

  // 查找是否已有相同标题的Issue
  const { data: issues } = await octokit.rest.issues.listForRepo({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    state: 'all',
    per_page: 100,
  });

  const existingIssue = issues.find(issue => issue.title === subjectId);
  
  if (existingIssue) {
    return {
      success: true,
      issue: {
        number: existingIssue.number,
        html_url: existingIssue.html_url,
        title: existingIssue.title
      }
    };
  }

  // 创建新Issue
  const issueBody = `
被试ID: ${subjectId}
性别: ${gender || '未提供'}
年龄: ${age || '未提供'}
实验数据记录:
`;

  const { data: newIssue } = await octokit.rest.issues.create({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    title: subjectId,
    body: issueBody.trim(),
  });

  return {
    success: true,
    issue: {
      number: newIssue.number,
      html_url: newIssue.html_url,
      title: newIssue.title
    }
  };
}

// 添加Issue评论
async function handleAddComment(body) {
  const { issueNumber, commentBody } = body;
  
  if (!issueNumber || !commentBody) {
    throw new Error('缺少issueNumber或commentBody参数');
  }

  const { data: comment } = await octokit.rest.issues.createComment({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    issue_number: issueNumber,
    body: commentBody,
  });

  return {
    success: true,
    comment: {
      id: comment.id,
      html_url: comment.html_url
    }
  };
}

// 上传文件到GitHub
async function handleUploadFile(body) {
  const { fileName, content, directory } = body;
  
  if (!fileName || !content) {
    throw new Error('缺少fileName或content参数');
  }

  // 构建完整文件路径
  const fullPath = directory ? `${directory}/${fileName}` : fileName;
  
  try {
    // 尝试获取现有文件信息
    const { data: existingFile } = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: fullPath,
    });

    // 如果文件存在，更新它
    const { data: updatedFile } = await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: fullPath,
      message: `Update ${fullPath}`,
      content: Buffer.from(content).toString('base64'),
      sha: existingFile.sha,
    });

    return {
      success: true,
      file: {
        sha: updatedFile.content.sha,
        html_url: updatedFile.content.html_url,
        path: updatedFile.content.path
      }
    };
  } catch (error) {
    // 如果文件不存在，创建新文件
    if (error.status === 404) {
      const { data: newFile } = await octokit.rest.repos.createOrUpdateFileContents({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: fullPath,
        message: `Create ${fullPath}`,
        content: Buffer.from(content).toString('base64'),
      });

      return {
        success: true,
        file: {
          sha: newFile.content.sha,
          html_url: newFile.content.html_url,
          path: newFile.content.path
        }
      };
    }
    throw error;
  }
}

// 主处理函数
module.exports = async (req, res) => {
  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return handleOptions(req, res);
  }

  // 只接受POST请求
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: '方法不允许，仅支持POST请求'
    });
  }

  try {
    const body = req.body;
    
    if (!body || !body.action) {
      return res.status(400).json({
        success: false,
        error: '缺少action参数'
      });
    }

    let result;
    switch (body.action) {
      case 'create_issue':
        result = await handleCreateIssue(body);
        break;
      case 'add_comment':
        result = await handleAddComment(body);
        break;
      case 'upload_file':
        result = await handleUploadFile(body);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: `不支持的操作: ${body.action}`
        });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('API错误:', error);
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || '服务器内部错误',
      status: error.status
    });
  }
};
