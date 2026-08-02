const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validator');
const prisma = require('../utils/prisma');
const multer = require('multer');
const path = require('path');
const { uploadToStorage } = require('../utils/supabase');
const { createNotification } = require('../utils/notifications');

const router = express.Router();

// Multer memory storage configuration for multiple post uploads
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Format rejected. Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB Total Limit
});

// Middleware to check if user is Admin or Moderator of the community
async function requireCommunityAdminOrModerator(req, res, next) {
  try {
    const communityId = Number(req.params.communityId);
    const userId = Number(req.user.id);

    if (isNaN(communityId)) {
      return res.status(400).json({ success: false, message: 'Invalid Community ID' });
    }

    const membership = await prisma.communityMember.findFirst({
      where: {
        community_id: communityId,
        user_id: userId,
        role: { in: ['Owner', 'Admin', 'Moderator'] }
      }
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Only Community Admins or Moderators can perform this action.'
      });
    }

    next();
  } catch (error) {
    console.error('requireCommunityAdminOrModerator error:', error.message);
    res.status(500).json({ success: false, message: 'Internal authorization error' });
  }
}

/**
 * GET /api/community/posts/global-feed?page=1&limit=10
 * Fetch posts from ALL communities, visible to any authenticated user.
 * No membership check — it's a public global community feed.
 * Returns: post data, author (with avatar_url), community name+avatar, likes, comments, liked_by_me flag.
 * Ordered: newest first.
 */
router.get('/posts/global-feed', authenticateUser, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;
    const currentUserId = Number(req.user.id);

    const [posts, totalCount] = await Promise.all([
      prisma.communityPost.findMany({
        skip,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              name: true,
              screen_name: true,
              display_preference: true,
              avatar_url: true,
              role: true
            }
          },
          community: {
            select: {
              id: true,
              name: true,
              avatar_url: true
            }
          },
          likes: {
            select: { user_id: true }
          },
          comments: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  screen_name: true,
                  display_preference: true,
                  avatar_url: true
                }
              }
            },
            orderBy: { created_at: 'asc' },
            take: 5 // Only fetch the first 5 comments for the feed; more can be loaded separately
          },
          _count: {
            select: { comments: true, likes: true }
          }
        },
        orderBy: [
          { is_pinned: 'desc' },
          { created_at: 'desc' }
        ]
      }),
      prisma.communityPost.count()
    ]);

    // Add liked_by_me flag for the current user
    const postsWithLikedByMe = posts.map(post => ({
      ...post,
      liked_by_me: post.likes.some(like => like.user_id === currentUserId),
      like_count: post._count.likes,
      comment_count: post._count.comments
    }));

    res.json({
      success: true,
      data: postsWithLikedByMe,
      pagination: {
        page,
        limit,
        total: totalCount,
        hasMore: skip + posts.length < totalCount
      }
    });
  } catch (error) {
    console.error('Global feed fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load global community feed' });
  }
});

/**
 * GET /api/community/:communityId/posts
 * Fetch all posts in a community (pinned posts first, then newest)
 */
router.get('/:communityId/posts', authenticateUser, async (req, res) => {
  try {
    const communityId = Number(req.params.communityId);
    if (isNaN(communityId)) {
      return res.status(400).json({ success: false, message: 'Invalid Community ID' });
    }

    // Confirm membership
    const isMember = await prisma.communityMember.findFirst({
      where: { community_id: communityId, user_id: Number(req.user.id) }
    });

    if (!isMember) {
      return res.status(403).json({ success: false, message: 'Must be a community member to view posts' });
    }

    const posts = await prisma.communityPost.findMany({
      where: { community_id: communityId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            screen_name: true,
            avatar_url: true,
            role: true
          }
        },
        likes: {
          select: {
            user_id: true
          }
        },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                screen_name: true,
                avatar_url: true
              }
            }
          },
          orderBy: { created_at: 'asc' }
        }
      },
      orderBy: [
        { is_pinned: 'desc' },
        { created_at: 'desc' }
      ]
    });

    res.json({ success: true, data: posts });
  } catch (error) {
    console.error('Fetch posts error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load posts' });
  }
});

/**
 * POST /api/community/:communityId/posts
 * Create a new post. Admins/Moderators only.
 */
router.post(
  '/:communityId/posts',
  authenticateUser,
  requireCommunityAdminOrModerator,
  upload.array('images', 10),
  async (req, res) => {
    try {
      const communityId = Number(req.params.communityId);
      const authorId = Number(req.user.id);
      const { caption } = req.body;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one image is required for a post' });
      }

      // Upload all images to Supabase / local storage
      const mediaUrls = [];
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const ext = path.extname(file.originalname) || '.jpg';
        const fileName = `post-${communityId}-${authorId}-${Date.now()}-${i}${ext}`;
        const url = await uploadToStorage(file.buffer, 'posts', fileName, file.mimetype);
        mediaUrls.push(url);
      }

      // Create CommunityPost
      const post = await prisma.communityPost.create({
        data: {
          community_id: communityId,
          author_id: authorId,
          caption: caption || '',
          media_urls: mediaUrls,
          is_pinned: false
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              screen_name: true,
              avatar_url: true,
              role: true
            }
          },
          likes: true,
          comments: true
        }
      });

      // Fetch all community members to send notifications
      const members = await prisma.communityMember.findMany({
        where: { community_id: communityId, user_id: { not: authorId } },
        select: { user_id: true }
      });

      const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: { name: true }
      });

      // Send notifications
      for (const member of members) {
        try {
          await createNotification({
            userId: member.user_id,
            type: 'community_post',
            title: `New post in ${community.name}`,
            body: `${post.author.screen_name || post.author.name} published a new post: "${caption ? caption.substring(0, 50) : 'View post'}"`,
            linkUrl: '/chat' // Opens community page/feed
          });
        } catch (notifErr) {
          console.error(`Failed to send post notification to user ${member.user_id}:`, notifErr.message);
        }
      }

      res.status(201).json({ success: true, message: 'Community post created successfully', data: post });
    } catch (error) {
      console.error('Create post error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to create post' });
    }
  }
);

/**
 * PUT /api/community/:communityId/posts/:postId
 * Edit a post caption/pin status
 */
router.put(
  '/:communityId/posts/:postId',
  authenticateUser,
  async (req, res) => {
    try {
      const communityId = Number(req.params.communityId);
      const postId = Number(req.params.postId);
      const userId = Number(req.user.id);
      const { caption } = req.body;

      const post = await prisma.communityPost.findUnique({
        where: { id: postId }
      });

      if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
      }

      // Check authorization (only author, or community admins/mods)
      const isAuthor = post.author_id === userId;
      const membership = await prisma.communityMember.findFirst({
        where: {
          community_id: communityId,
          user_id: userId,
          role: { in: ['Owner', 'Admin', 'Moderator'] }
        }
      });

      if (!isAuthor && !membership) {
        return res.status(403).json({ success: false, message: 'Unauthorized to edit this post' });
      }

      const updatedPost = await prisma.communityPost.update({
        where: { id: postId },
        data: { caption: caption !== undefined ? caption : post.caption },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              screen_name: true,
              avatar_url: true,
              role: true
            }
          },
          likes: { select: { user_id: true } },
          comments: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  screen_name: true,
                  avatar_url: true
                }
              }
            }
          }
        }
      });

      res.json({ success: true, message: 'Post updated successfully', data: updatedPost });
    } catch (error) {
      console.error('Edit post error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to edit post' });
    }
  }
);

/**
 * DELETE /api/community/:communityId/posts/:postId
 * Delete a community post
 */
router.delete(
  '/:communityId/posts/:postId',
  authenticateUser,
  async (req, res) => {
    try {
      const communityId = Number(req.params.communityId);
      const postId = Number(req.params.postId);
      const userId = Number(req.user.id);

      const post = await prisma.communityPost.findUnique({
        where: { id: postId }
      });

      if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
      }

      const isAuthor = post.author_id === userId;
      const membership = await prisma.communityMember.findFirst({
        where: {
          community_id: communityId,
          user_id: userId,
          role: { in: ['Owner', 'Admin', 'Moderator'] }
        }
      });

      if (!isAuthor && !membership) {
        return res.status(403).json({ success: false, message: 'Unauthorized to delete this post' });
      }

      await prisma.communityPost.delete({
        where: { id: postId }
      });

      res.json({ success: true, message: 'Post deleted successfully' });
    } catch (error) {
      console.error('Delete post error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to delete post' });
    }
  }
);

/**
 * POST /api/community/:communityId/posts/:postId/like
 * Toggle like status on a post
 */
router.post(
  '/:communityId/posts/:postId/like',
  authenticateUser,
  async (req, res) => {
    try {
      const postId = Number(req.params.postId);
      const userId = Number(req.user.id);

      const existingLike = await prisma.communityPostLike.findUnique({
        where: {
          post_id_user_id: {
            post_id: postId,
            user_id: userId
          }
        }
      });

      let liked = false;
      if (existingLike) {
        await prisma.communityPostLike.delete({
          where: { id: existingLike.id }
        });
      } else {
        await prisma.communityPostLike.create({
          data: { post_id: postId, user_id: userId }
        });
        liked = true;
      }

      res.json({ success: true, liked });
    } catch (error) {
      console.error('Like toggle error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to update like status' });
    }
  }
);

/**
 * POST /api/community/:communityId/posts/:postId/comment
 * Add a comment to a post
 */
router.post(
  '/:communityId/posts/:postId/comment',
  authenticateUser,
  [
    body('content').notEmpty().withMessage('Comment content cannot be empty')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const postId = Number(req.params.postId);
      const userId = Number(req.user.id);
      const { content } = req.body;

      const comment = await prisma.communityPostComment.create({
        data: {
          post_id: postId,
          user_id: userId,
          content
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              screen_name: true,
              avatar_url: true
            }
          }
        }
      });

      res.status(201).json({ success: true, message: 'Comment added successfully', data: comment });
    } catch (error) {
      console.error('Add comment error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to add comment' });
    }
  }
);

/**
 * POST /api/community/:communityId/posts/:postId/pin
 * Toggle pin status of a post. Admins/Moderators only.
 */
router.post(
  '/:communityId/posts/:postId/pin',
  authenticateUser,
  requireCommunityAdminOrModerator,
  async (req, res) => {
    try {
      const postId = Number(req.params.postId);

      const post = await prisma.communityPost.findUnique({
        where: { id: postId }
      });

      if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
      }

      const updated = await prisma.communityPost.update({
        where: { id: postId },
        data: { is_pinned: !post.is_pinned }
      });

      res.json({
        success: true,
        message: updated.is_pinned ? 'Post pinned to top' : 'Post unpinned',
        is_pinned: updated.is_pinned
      });
    } catch (error) {
      console.error('Pin post error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to update pin status' });
    }
  }
);

module.exports = router;
