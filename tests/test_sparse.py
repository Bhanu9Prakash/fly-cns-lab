import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from simulate import simulate
from simulate_full import simulate_sparse

class SparseParity(unittest.TestCase):
    def test_sparse_preserves_inhibition_lesion_and_direction(self):
        nodes=[dict(id=i,type='LC4' if i==0 else 'relay',side='L',nt=nt,total_input=100,group='visual' if i==0 else 'motor') for i,nt in enumerate(['acetylcholine','gaba','glutamate'])]
        edges=[[0,1,70],[1,2,40],[0,2,30],[2,0,20]]
        graph=dict(nodes=nodes,edges=edges)
        for options in [dict(),dict(silenced=[1]),dict(glutamate='excitatory'),dict(amplitude=0),dict(mode='unsigned')]:
            with self.subTest(options=options):
                scalar=simulate(graph,**options)
                sparse=simulate_sparse(nodes,edges,**options)
                np.testing.assert_allclose(sparse['activity'],scalar['activity'],atol=1e-12,rtol=0)

if __name__=='__main__':unittest.main()
