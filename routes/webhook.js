const express = require('express');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const Pusher = require('pusher');


const router = express.Router();

// Configure Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true,
});

// CRITICAL: Razorpay webhooks demand raw request body for matching HMAC signatures
router.post(
    '/webhook/razorpay',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const signature = req.headers['x-razorpay-signature'];
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!signature || !webhookSecret) {
            return res.status(400).json({ error: 'Missing webhook verification signatures' });
        }

        try {
            // 🔒 1. Cryptographic HMAC Verification using raw Body
            const rawBody = req.rawBody ? req.rawBody.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(rawBody)
                .digest('hex');

            if (expectedSignature !== signature) {
                return res.status(400).json({ error: 'Invalid cryptographic checksum signature' });
            }

            const payload = JSON.parse(rawBody);
            const event = payload.event;

            // Handle payment failure event
            if (event === 'payment.failed') {
                const paymentEntity = payload.payload?.payment?.entity;
                const orderId = paymentEntity?.order_id;
                const userId = paymentEntity?.notes?.user_id ? parseInt(paymentEntity.notes.user_id) : (paymentEntity?.notes?.userId ? parseInt(paymentEntity.notes.userId) : null);
                const draftId = paymentEntity?.notes?.draft_id ? parseInt(paymentEntity.notes.draft_id) : (paymentEntity?.notes?.draftId ? parseInt(paymentEntity.notes.draftId) : null);

                await prisma.$transaction(async (tx) => {
                    if (orderId) {
                        await tx.scriptUploadPayment.updateMany({
                            where: { razorpay_order_id: orderId },
                            data: { status: 'failed', updated_at: new Date() }
                        });
                    }
                    if (draftId && userId) {
                        await tx.scriptDraft.deleteMany({
                            where: { id: draftId, user_id: userId }
                        });
                    }
                });
                return res.status(200).json({ success: true, message: 'Payment marked as failed and draft removed.' });
            }

            // Guard: Only process successful payments
            if (event !== 'payment.captured' && event !== 'order.paid') {
                return res.status(200).json({ success: true, message: `Ignored unhandled event: ${event}` });
            }

            const paymentEntity = payload.payload?.payment?.entity;
            const orderId = paymentEntity?.order_id;
            const paymentId = paymentEntity?.id;
            
            // Safe extraction supporting both camelCase and snake_case notes
            const userId = paymentEntity?.notes?.user_id ? parseInt(paymentEntity.notes.user_id) : (paymentEntity?.notes?.userId ? parseInt(paymentEntity.notes.userId) : null);
            const draftId = paymentEntity?.notes?.draft_id ? parseInt(paymentEntity.notes.draft_id) : (paymentEntity?.notes?.draftId ? parseInt(paymentEntity.notes.draftId) : null);
            const creditsToAllocate = paymentEntity?.notes?.credits ? parseInt(paymentEntity.notes.credits) : (paymentEntity?.notes?.creditsToAllocate ? parseInt(paymentEntity.notes.creditsToAllocate) : 0);

            if (!orderId || !userId || !paymentId) {
                return res.status(422).json({ error: 'Missing mandatory tracking metadata parameters' });
            }

            // 🔄 2. Atomic Isolation & Pessimistic Locking Sequence
            const transactionResult = await prisma.$transaction(async (tx) => {
                
                // MySQL Row-Level Lock: Stops concurrent webhook fires for the exact same Order ID
                const existingPayments = await tx.$queryRaw`
                    SELECT * FROM script_upload_payments 
                    WHERE razorpay_order_id = ${orderId} 
                    FOR UPDATE
                `;
                
                const paymentRecord = existingPayments[0];

                if (!paymentRecord) {
                    throw new Error('Order tracking record not found in structural database engine');
                }

                // Idempotency Layer Guard: If status is already processed, intercept early
                if (paymentRecord.status === 'successful') {
                    return {
                        status: 'cached',
                        message: 'Idempotency Intercept: This payment loop was already executed.',
                        scriptId: paymentRecord.script_id
                    };
                }

                let scriptId = paymentRecord.script_id;

                // Promote draft script to scripts table if draftId is present and draft exists
                if (draftId && !scriptId) {
                    const draft = await tx.scriptDraft.findUnique({
                        where: { id: draftId }
                    });

                    if (draft) {
                        const script = await tx.script.create({
                            data: {
                                user_id: draft.user_id,
                                title: draft.title,
                                genre: draft.genre,
                                synopsis: draft.synopsis,
                                poster_url: draft.poster_url,
                                roles_needed: draft.roles_needed,
                                status: draft.status || 'Open for collaboration',
                                media_links: draft.media_links,
                                role_data: draft.role_data,
                                work_type: draft.work_type || 'Script',
                                approval_status: 'pending',
                                payment_status: 'paid',
                                payment_id: paymentId,
                                payment_verified: true
                            }
                        });
                        scriptId = script.id;

                        // Delete the draft script
                        await tx.scriptDraft.delete({
                            where: { id: draftId }
                        });

                        // Trigger Pusher notification
                        try {
                            if (process.env.PUSHER_APP_ID) {
                                pusher.trigger('admin-dashboard', 'update', {
                                    type: 'NEW_SCRIPT',
                                    scriptId,
                                    title: draft.title
                                });
                            }
                        } catch (pusherErr) {
                            console.error('[Webhook] Pusher trigger failed:', pusherErr.message);
                        }
                    }
                }

                // 3. Update the Script Upload Payment Status
                await tx.scriptUploadPayment.update({
                    where: { razorpay_order_id: orderId },
                    data: {
                        razorpay_payment_id: paymentId,
                        razorpay_signature: signature,
                        status: 'successful',
                        script_id: scriptId,
                        updated_at: new Date()
                    }
                });

                if (creditsToAllocate > 0) {
                    // 4. Update User Credits Ledger (Matches schema model explicitly)
                    await tx.user.update({
                        where: { id: userId },
                        data: {
                            credits: { increment: creditsToAllocate }
                        }
                    });

                    // 5. Insert History Track into CreditTransaction mapping
                    await tx.creditTransaction.create({
                        data: {
                            user_id: userId,
                            amount: creditsToAllocate,
                            reason: `Razorpay Webhook Auto Allocation: Order ${orderId}`,
                            type: 'CREDIT'
                        }
                    });
                }

                return {
                    status: 'processed',
                    message: 'Webhook pipeline synchronized and transaction closed clean.',
                    scriptId
                };
            }, {
                timeout: 3000 // 3-second thread protection timeout to protect MySQL connection pools
            });

            // Return HTTP 200 for both fresh and deduplicated events
            return res.status(200).json({
                success: true,
                meta: transactionResult.message,
                script_id: transactionResult.scriptId
            });

        } catch (error) {
            console.error(`[CRITICAL WEBHOOK ERROR]: ${error.message}`);
            return res.status(500).json({ error: 'Internal pipeline optimization fault' });
        }
    }
);

module.exports = router;