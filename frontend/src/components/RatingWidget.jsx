import { useState } from 'react';
import { api } from '../api';
import './RatingWidget.css';

/**
 * Satisfaction rating widget with 5 clickable stars and optional comment.
 *
 * Props:
 *   conversationId - UUID of the conversation
 *   messageIndex   - Index of the assistant message in conversation.messages
 *   existingRating - If set, shows the locked rating (no re-rating)
 *   onRate         - Callback after successful rating submission
 */
export default function RatingWidget({ conversationId, messageIndex, existingRating, onRate }) {
    const [hoveredStar, setHoveredStar] = useState(0);
    const [selectedScore, setSelectedScore] = useState(0);
    const [comment, setComment] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const isLocked = !!existingRating || submitted;
    const displayScore = existingRating?.score || (submitted ? selectedScore : 0);
    const displayComment = existingRating?.comment || '';

    const handleStarClick = (score) => {
        if (isLocked) return;
        setSelectedScore(score);
    };

    const handleSubmit = async () => {
        if (submitting || isLocked || selectedScore === 0) return;
        setSubmitting(true);
        setError(null);

        try {
            await api.submitRating(conversationId, messageIndex, selectedScore, comment || null);
            setSubmitted(true);
            if (onRate) {
                onRate({ score: selectedScore, comment });
            }
        } catch (err) {
            setError(err.message || 'Failed to submit rating');
        } finally {
            setSubmitting(false);
        }
    };

    // Locked state: show existing or just-submitted rating
    if (isLocked) {
        return (
            <div className="rating-widget rating-widget--locked">
                <div className="rating-stars">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <span
                            key={star}
                            className={`rating-star ${star <= displayScore ? 'rating-star--filled' : 'rating-star--empty'}`}
                        >
                            {star <= displayScore ? '\u2605' : '\u2606'}
                        </span>
                    ))}
                </div>
                {displayComment && (
                    <p className="rating-comment-display">{displayComment}</p>
                )}
                <p className="rating-thanks">
                    {submitted ? 'Thanks for your feedback' : 'Rated'}
                </p>
            </div>
        );
    }

    // Interactive state
    return (
        <div className="rating-widget">
            <div className="rating-prompt">Rate this response</div>
            <div className="rating-stars">
                {[1, 2, 3, 4, 5].map((star) => {
                    const isFilled = star <= (hoveredStar || selectedScore);
                    return (
                        <button
                            key={star}
                            className={`rating-star rating-star--interactive ${isFilled ? 'rating-star--filled' : 'rating-star--empty'}`}
                            onMouseEnter={() => setHoveredStar(star)}
                            onMouseLeave={() => setHoveredStar(0)}
                            onClick={() => handleStarClick(star)}
                            aria-label={`Rate ${star} out of 5`}
                        >
                            {isFilled ? '\u2605' : '\u2606'}
                        </button>
                    );
                })}
            </div>

            {selectedScore > 0 && (
                <div className="rating-comment-section">
                    <textarea
                        className="rating-comment-input"
                        placeholder="Optional: share your thoughts..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={3}
                    />
                    <button
                        className="rating-submit-btn"
                        onClick={handleSubmit}
                        disabled={submitting}
                    >
                        {submitting ? 'Submitting...' : 'Submit Rating'}
                    </button>
                </div>
            )}

            {error && <p className="rating-error">{error}</p>}
        </div>
    );
}
