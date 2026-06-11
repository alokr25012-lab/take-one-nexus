const express = require('express');
const { authenticateUser, requireVerified } = require('../middleware/auth');
const prisma = require('../utils/prisma');
const { createNotification } = require('../utils/notifications');
const { getCanonicalDisplayName } = require('../utils/formatting');

const router = express.Router();

/**
 * POST /api/opportunities
 * Create a new opportunity (verified users only)
 */
router.post('/', authenticateUser, requireVerified, async (req, res) => {
  try {
    const { title, description, roles_needed } = req.body;
    const userId = Number(req.user.id);

    if (!title || !description || !roles_needed) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, and required roles are required.'
      });
    }

    const opportunity = await prisma.opportunity.create({
      data: {
        title,
        description,
        roles_needed,
        user_id: userId
      }
    });

    res.status(201).json({
      success: true,
      message: 'Opportunity posted successfully.',
      data: opportunity
    });
  } catch (error) {
    console.error('[Opportunities] Create error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not create opportunity post.'
    });
  }
});

/**
 * GET /api/opportunities
 * Retrieve all opportunities with search and filter queries
 */
router.get('/', async (req, res) => {
  try {
    const { search, role } = req.query;

    const where = {};

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } }
      ];
    }

    if (role) {
      where.roles_needed = { contains: role };
    }

    const opportunities = await prisma.opportunity.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar_url: true,
            display_preference: true,
            screen_name: true
          }
        },
        applications: {
          select: {
            id: true,
            applicant_id: true,
            status: true
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      data: opportunities
    });
  } catch (error) {
    console.error('[Opportunities] List error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not retrieve opportunities.'
    });
  }
});

/**
 * GET /api/opportunities/my-posts
 * Retrieve opportunities posted by the current user
 */
router.get('/my-posts', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    const opportunities = await prisma.opportunity.findMany({
      where: { user_id: userId },
      include: {
        applications: {
          include: {
            applicant: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar_url: true,
                display_preference: true,
                screen_name: true
              }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      data: opportunities
    });
  } catch (error) {
    console.error('[Opportunities] My posts error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not load your posts.'
    });
  }
});

/**
 * GET /api/opportunities/my-applications
 * Retrieve applications submitted by the current user
 */
router.get('/my-applications', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    const applications = await prisma.opportunityApplication.findMany({
      where: { applicant_id: userId },
      include: {
        opportunity: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar_url: true,
                display_preference: true,
                screen_name: true
              }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      data: applications
    });
  } catch (error) {
    console.error('[Opportunities] My applications error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not load your applications.'
    });
  }
});

/**
 * POST /api/opportunities/:id/apply
 * Apply to a specific opportunity
 */
router.post('/:id/apply', authenticateUser, requireVerified, async (req, res) => {
  try {
    const opportunityId = Number(req.params.id);
    const applicantId = Number(req.user.id);
    const { message } = req.body;

    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: { user: true }
    });

    if (!opportunity) {
      return res.status(404).json({
        success: false,
        message: 'Opportunity not found.'
      });
    }

    if (opportunity.user_id === applicantId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot apply to your own opportunity post.'
      });
    }

    // Check if already applied
    const existingApplication = await prisma.opportunityApplication.findUnique({
      where: {
        opportunity_id_applicant_id: {
          opportunity_id: opportunityId,
          applicant_id: applicantId
        }
      }
    });

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: 'You have already applied to this opportunity.'
      });
    }

    const application = await prisma.opportunityApplication.create({
      data: {
        opportunity_id: opportunityId,
        applicant_id: applicantId,
        message: message || null
      }
    });

    // Create notification for the opportunity owner
    const applicantUser = await prisma.user.findUnique({
      where: { id: applicantId }
    });

    try {
      await createNotification({
        userId: opportunity.user_id,
        type: 'opportunity_apply',
        title: 'New application received',
        body: `${getCanonicalDisplayName(applicantUser)} applied for "${opportunity.title}".`,
        linkUrl: '/opportunities.htm#my-posts'
      });
    } catch (notificationError) {
      console.error('[Opportunities] Application notification error:', notificationError.message);
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully.',
      data: application
    });
  } catch (error) {
    console.error('[Opportunities] Apply error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not submit application.'
    });
  }
});

/**
 * PATCH /api/opportunities/applications/:id/status
 * Accept or Reject an application (owner of the opportunity only)
 */
router.patch('/applications/:id/status', authenticateUser, async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    const { status } = req.body;
    const userId = Number(req.user.id);

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be accepted or rejected.'
      });
    }

    const application = await prisma.opportunityApplication.findUnique({
      where: { id: applicationId },
      include: {
        opportunity: true,
        applicant: true
      }
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found.'
      });
    }

    if (application.opportunity.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator of the opportunity can update application status.'
      });
    }

    const updatedApplication = await prisma.opportunityApplication.update({
      where: { id: applicationId },
      data: { status }
    });

    // Notify applicant
    try {
      await createNotification({
        userId: application.applicant_id,
        type: `opportunity_${status}`,
        title: `Application ${status}`,
        body: `Your application for "${application.opportunity.title}" was ${status}.`,
        linkUrl: '/opportunities.htm#my-applications'
      });
    } catch (notificationError) {
      console.error('[Opportunities] Status update notification error:', notificationError.message);
    }

    res.json({
      success: true,
      message: `Application ${status} successfully.`,
      data: updatedApplication
    });
  } catch (error) {
    console.error('[Opportunities] Update application status error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not update application status.'
    });
  }
});

module.exports = router;
