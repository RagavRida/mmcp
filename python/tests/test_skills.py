"""Tests for mmcp_core.skill_engine — save, load, fuzzy match."""
from __future__ import annotations
from mmcp_core.planner import ExecutionPlan, PlanStep
from mmcp_core.skill_engine import (
    save_skill, load_skill, list_skills, delete_skill,
    find_similar_skill, _jaccard_similarity, _tokenize,
)


class TestSaveAndLoad:
    def test_round_trip(self, tmp_skills_dir):
        """Save a skill → load it → steps match."""
        plan = ExecutionPlan(task="write a blog post", steps=[
            PlanStep(step=1, action="research", description="Research topic",
                     prompt="Research AI"),
            PlanStep(step=2, action="write", description="Write post",
                     prompt="Write blog post", depends_on=[1]),
        ])
        path = save_skill("blog writing", plan)
        assert "blog_writing.json" in path

        loaded = load_skill("blog writing")
        assert loaded is not None
        assert len(loaded.steps) == 2
        assert loaded.steps[0].action == "research"
        assert loaded.steps[1].depends_on == [1]

    def test_load_nonexistent(self, tmp_skills_dir):
        """Loading a nonexistent skill returns None."""
        result = load_skill("does not exist")
        assert result is None


class TestListAndDelete:
    def test_list_skills(self, tmp_skills_dir):
        """list_skills returns metadata for saved skills."""
        plan = ExecutionPlan(task="test task", steps=[
            PlanStep(step=1, action="quick", description="Do it"),
        ])
        save_skill("test skill", plan)
        save_skill("another skill", plan)

        skills = list_skills()
        assert len(skills) == 2
        names = {s["name"] for s in skills}
        assert "test skill" in names
        assert "another skill" in names

    def test_delete_skill(self, tmp_skills_dir):
        """delete_skill removes the skill file."""
        plan = ExecutionPlan(task="test", steps=[
            PlanStep(step=1, action="quick", description="Do it"),
        ])
        save_skill("doomed skill", plan)
        assert len(list_skills()) == 1

        result = delete_skill("doomed skill")
        assert result is True
        assert len(list_skills()) == 0

    def test_delete_nonexistent(self, tmp_skills_dir):
        """Deleting a nonexistent skill returns False."""
        assert delete_skill("nope") is False


class TestFuzzyMatching:
    def test_tokenize(self):
        """_tokenize extracts lowercase words."""
        assert _tokenize("Write a Blog Post!") == {"write", "a", "blog", "post"}

    def test_jaccard_identical(self):
        """Identical sets have similarity 1.0."""
        assert _jaccard_similarity({"a", "b"}, {"a", "b"}) == 1.0

    def test_jaccard_disjoint(self):
        """Disjoint sets have similarity 0.0."""
        assert _jaccard_similarity({"a", "b"}, {"c", "d"}) == 0.0

    def test_jaccard_partial(self):
        """Partial overlap gives expected similarity."""
        sim = _jaccard_similarity({"a", "b", "c"}, {"b", "c", "d"})
        assert 0.4 < sim < 0.6  # 2/4 = 0.5

    def test_find_similar_above_threshold(self, tmp_skills_dir):
        """find_similar_skill matches when similarity > threshold."""
        plan = ExecutionPlan(task="write a blog post about AI", steps=[
            PlanStep(step=1, action="write", description="Write"),
        ])
        save_skill("blog post writing", plan)

        match = find_similar_skill("write a blog post about technology")
        assert match is not None
        assert match["name"] == "blog post writing"
        assert match["similarity"] > 0.3

    def test_find_similar_below_threshold(self, tmp_skills_dir):
        """find_similar_skill returns None for unrelated tasks."""
        plan = ExecutionPlan(task="deploy kubernetes cluster", steps=[
            PlanStep(step=1, action="code", description="Deploy"),
        ])
        save_skill("kubernetes deployment", plan)

        match = find_similar_skill("write a haiku about cats")
        assert match is None

    def test_find_similar_empty_cache(self, tmp_skills_dir):
        """No saved skills → returns None."""
        match = find_similar_skill("anything at all")
        assert match is None
